import { NextResponse } from "next/server";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { rateLimit } from "@/lib/rate-limit";

import { createClient } from "@supabase/supabase-js";

const PAYTR_MERCHANT_ID = process.env.PAYTR_MERCHANT_ID || "test_merchant_id";
const PAYTR_MERCHANT_KEY = process.env.PAYTR_MERCHANT_KEY || "test_merchant_key";
const PAYTR_MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT || "test_merchant_salt";

// Service role to bypass RLS
// Fallback değerler build sırasında modül yüklenebilsin diye (env o anda boş)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key"
);

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { locale } = await getPreferences();
    if (!["owner", "admin"].includes(user.role)) {
      return NextResponse.json({
        error: locale === "tr"
          ? "Yalnızca workspace sahibi veya admin ödeme başlatabilir."
          : "Only the workspace owner or an admin can start a payment."
      }, { status: 403 });
    }
    if (user.workspace.id === "pending") {
      return NextResponse.json({
        error: locale === "tr"
          ? "Çalışma alanınız henüz hazırlanıyor. Lütfen birkaç saniye sonra tekrar deneyin."
          : "Your workspace is still being prepared. Please try again in a few seconds."
      }, { status: 409 });
    }

    const { ok } = rateLimit(`paytr:${user.id}`);
    if (!ok) {
      return NextResponse.json({
        error: locale === "tr"
          ? "Çok fazla deneme yaptınız. Lütfen biraz bekleyin."
          : "Too many attempts. Please wait a moment."
      }, { status: 429, headers: { "Retry-After": "60" } });
    }

    const body = await request.json().catch(() => null) as { packageId?: string; couponCode?: string | null } | null;
    const packageId = body?.packageId;
    const couponCode = body?.couponCode || null;
    if (!packageId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // Fetch package from database
    const { data: pkg, error: pkgError } = await supabaseAdmin
      .from("packages")
      .select("*")
      .eq("id", packageId)
      .eq("is_active", true)
      .single();

    if (pkgError || !pkg) {
      return NextResponse.json({ error: "Package not found or inactive" }, { status: 404 });
    }

    const isTurkey = request.headers.get("x-vercel-ip-country") === "TR" || request.headers.get("accept-language")?.includes("tr") || false;
    let payment_amount = pkg.price_kurus; // Kuruş cinsinden
    let payment_currency = pkg.currency || "USD";

    if (isTurkey && pkg.price_kurus_try > 0) {
      payment_amount = pkg.price_kurus_try;
      payment_currency = "TL";
    }

    if (payment_currency === "TRY") payment_currency = "TL";

    let appliedCouponCode: string | null = null;

    // Kupon doğrulama ve indirim uygulama
    if (couponCode) {
      const { data: coupon, error: couponError } = await supabaseAdmin
        .from("coupons")
        .select("*")
        .eq("code", couponCode)
        .eq("is_active", true)
        .single();

      if (!couponError && coupon) {
        let isValid = true;
        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) isValid = false;
        if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) isValid = false;

        if (isValid) {
          if (coupon.discount_type === "percentage") {
            const discountAmount = Math.floor(payment_amount * (coupon.discount_value / 100));
            payment_amount -= discountAmount;
          } else if (coupon.discount_type === "fixed") {
            payment_amount -= coupon.discount_value;
          }
          if (payment_amount < 0) payment_amount = 0;
          appliedCouponCode = coupon.code;
        }
      }
    }

    // PayTR merchant_oid yalnızca alfanümerik karakter kabul eder; bu yüzden sipariş
    // bilgileri oid içine gömülmek yerine payment_orders tablosunda tutulur ve
    // callback bu tablodan okur.
    const merchant_oid = generateMerchantOid();
    const { error: orderError } = await supabaseAdmin.from("payment_orders").insert({
      merchant_oid,
      workspace_id: user.workspace.id,
      package_id: pkg.id,
      coupon_code: appliedCouponCode,
      amount_kurus: payment_amount,
      status: "pending",
    });

    if (orderError) {
      console.error("[paytr/token] Sipariş kaydı oluşturulamadı:", orderError.message);
      return NextResponse.json(
        {
          error: locale === "tr"
            ? "Ödeme kaydı oluşturulamadı. (payment_orders tablosu eksikse supabase/fix-payments.sql çalıştırılmalı.)"
            : "Could not create the payment record. (If the payment_orders table is missing, run supabase/fix-payments.sql.)"
        },
        { status: 503 }
      );
    }

    const user_name = user.name;
    const user_address = "Adres Belirtilmedi"; // Dijital servis
    const user_phone = "05555555555";
    const email = user.email;
    const user_ip = request.headers.get("x-forwarded-for") || "127.0.0.1";
    const currency = payment_currency;
    const test_mode = process.env.NODE_ENV === "production" ? "0" : "1";
    const no_installment = "1"; // Taksit yapılmasın
    const max_installment = "0";

    // Kredi kartına yansıyacak ürün adı
    const user_basket = Buffer.from(JSON.stringify([
      [`SupaOps ${pkg.name}`, payment_amount.toString(), 1]
    ])).toString("base64");

    // PayTR Hash hesaplama mantığı
    const hash_str = `${PAYTR_MERCHANT_ID}${user_ip}${merchant_oid}${email}${payment_amount}${user_basket}${no_installment}${max_installment}${currency}${test_mode}`;
    const paytr_token = crypto.createHmac('sha256', PAYTR_MERCHANT_KEY)
      .update(hash_str + PAYTR_MERCHANT_SALT)
      .digest('base64');

    // PayTR'a gönderilecek tüm parametreler
    const tokenData = {
      merchant_id: PAYTR_MERCHANT_ID,
      user_ip,
      merchant_oid,
      email,
      payment_amount,
      paytr_token,
      user_basket,
      debug_on: "1",
      no_installment,
      max_installment,
      user_name,
      user_address,
      user_phone,
      merchant_ok_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/app/settings/billing?status=success`,
      merchant_fail_url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/app/settings/billing?status=fail`,
      timeout_limit: "30",
      currency,
      test_mode,
      lang: "tr"
    };

    // 1. Adım: PayTR sunucusuna bu bilgileri göndererek asıl session token'ı (iframe için) almamız gerekiyor
    // (veya form olarak frontende basmamız lazım)
    // PayTR'da iFrame token'ı API'den çekilir:
    const formData = new URLSearchParams();
    Object.entries(tokenData).forEach(([key, val]) => {
      formData.append(key, String(val));
    });

    const response = await fetch("https://www.paytr.com/odeme/api/get-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const result = await response.json();

    if (result.status === "success") {
      return NextResponse.json({ token: result.token });
    } else {
      console.error("PayTR Token Error:", result.reason);
      return NextResponse.json({ error: result.reason }, { status: 502 });
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("PayTR Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function generateMerchantOid() {
  // Yalnızca harf ve rakam: PayTR oid'de başka karakter kabul etmiyor.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let oid = "BU";
  for (const byte of crypto.randomBytes(30)) {
    oid += chars[byte % chars.length];
  }
  return oid;
}
