import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// Service role to bypass RLS for entitlements update
// Fallback değerler build sırasında modül yüklenebilsin diye (env o anda boş)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key"
);

const PAYTR_MERCHANT_KEY = process.env.PAYTR_MERCHANT_KEY || "test_merchant_key";
const PAYTR_MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT || "test_merchant_salt";

export async function POST(request: Request) {
  try {
    // PayTR callback verileri URL-encoded form data olarak gelir
    const text = await request.text();
    const params = new URLSearchParams(text);

    const merchant_oid = params.get("merchant_oid");
    const status = params.get("status");
    const total_amount = params.get("total_amount");
    const hash = params.get("hash");

    if (!merchant_oid || !status || !total_amount || !hash) {
      return new NextResponse("Eksik parametre", { status: 400 });
    }

    // Güvenlik: PayTR'dan gelen hash'i doğrula
    const hash_str = merchant_oid + PAYTR_MERCHANT_SALT + status + total_amount;
    const expected_hash = crypto.createHmac('sha256', PAYTR_MERCHANT_KEY).update(hash_str).digest('base64');

    if (hash !== expected_hash) {
      console.error("PayTR Hash Mismatch");
      return new NextResponse("PAYTR_ERROR", { status: 400 });
    }

    // Sipariş bilgisi payment_orders tablosunda tutulur (oid alfanümerik olmak zorunda).
    const { data: order } = await supabaseAdmin
      .from("payment_orders")
      .select("id, workspace_id, package_id, coupon_code, amount_kurus, status")
      .eq("merchant_oid", merchant_oid)
      .maybeSingle();

    if (order) {
      // PayTR aynı callback'i tekrar gönderebilir; işlenmiş siparişi tekrar işleme.
      if (order.status === "paid") {
        return new NextResponse("OK", { status: 200 });
      }

      if (status !== "success") {
        console.error("PayTR Error:", params.get("failed_reason_code"), params.get("failed_reason_msg"));
        await supabaseAdmin
          .from("payment_orders")
          .update({ status: "failed", processed_at: new Date().toISOString() })
          .eq("id", order.id);
        return new NextResponse("OK", { status: 200 });
      }

      if (Number(total_amount) !== order.amount_kurus) {
        // Tutar uyuşmazlığı: yine de işle ama mutlaka iz bırak.
        console.warn(`[paytr/callback] Tutar uyuşmazlığı (oid ${merchant_oid}): beklenen ${order.amount_kurus}, gelen ${total_amount}`);
      }

      const applied = await applyEntitlements(order.workspace_id, order.package_id, order.coupon_code);
      if (!applied) {
        // "OK" dönersek PayTR callback'i bir daha göndermez ve müşteri ödediği halde
        // planı yükselmez. Hata dönerek PayTR'ın tekrar denemesini sağlıyoruz.
        return new NextResponse("RETRY", { status: 500 });
      }

      await supabaseAdmin
        .from("payment_orders")
        .update({ status: "paid", processed_at: new Date().toISOString() })
        .eq("id", order.id);

      return new NextResponse("OK", { status: 200 });
    }

    // Geriye dönük uyumluluk: eski format ORDER_{workspaceId}_{packageId}_{timestamp}_{couponCode}
    if (status === "success") {
      const parts = merchant_oid.split("_");
      if (parts.length >= 4 && parts[0] === "ORDER") {
        const workspaceId = parts[1];
        const packageId = parts[2];
        const couponCode = parts.length > 4 ? parts[4] : null;

        const applied = await applyEntitlements(workspaceId, packageId, couponCode);
        if (!applied) {
          return new NextResponse("RETRY", { status: 500 });
        }
        return new NextResponse("OK", { status: 200 });
      }

      // Hash doğru ama sipariş kaydı yok: veri kaybı olabilir, görünür kıl ve PayTR'a tekrar denetir.
      console.error(`[paytr/callback] Başarılı ödeme için sipariş kaydı bulunamadı: ${merchant_oid}`);
      return new NextResponse("ORDER_NOT_FOUND", { status: 500 });
    }

    console.error("PayTR Error:", params.get("failed_reason_code"), params.get("failed_reason_msg"));

    // PayTR'a işlemin başarıyla alındığını bildirmeliyiz
    return new NextResponse("OK", { status: 200 });

  } catch (error) {
    console.error("Webhook Error:", error);
    return new NextResponse("INTERNAL ERROR", { status: 500 });
  }
}

async function applyEntitlements(workspaceId: string, packageId: string, couponCode: string | null) {
  // Fetch package details
  const { data: pkg, error: pkgError } = await supabaseAdmin
    .from("packages")
    .select("plan_id, monthly_job_limit, parallel_job_limit")
    .eq("id", packageId)
    .single();

  if (pkgError || !pkg) {
    console.error("Callback package lookup error:", pkgError);
    return false;
  }

  const { error } = await supabaseAdmin
    .from("entitlements")
    .update({
      plan: pkg.plan_id,
      monthly_job_limit: pkg.monthly_job_limit,
      parallel_job_limit: pkg.parallel_job_limit,
      updated_at: new Date().toISOString()
    })
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("Entitlements update error", error);
    return false;
  }

  // Increment coupon used_count if a coupon was used.
  // Kupon sayacı ödeme başarısını etkilemesin: hata olursa yalnızca logla.
  if (couponCode) {
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("id, used_count")
      .eq("code", couponCode)
      .single();

    if (coupon) {
      const { error: couponError } = await supabaseAdmin
        .from("coupons")
        .update({ used_count: coupon.used_count + 1 })
        .eq("id", coupon.id);
      if (couponError) {
        console.error("Coupon increment error:", couponError.message);
      }
    } else {
      console.warn(`[paytr/callback] Kupon bulunamadı, sayaç artırılamadı: ${couponCode}`);
    }
  }

  return true;
}
