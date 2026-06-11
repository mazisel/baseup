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

    if (status === "success") {
      // merchant_oid formatımız: ORDER_{workspaceId}_{packageId}_{timestamp}_{couponCode(optional)}
      const parts = merchant_oid.split("_");
      if (parts.length >= 4 && parts[0] === "ORDER") {
        const workspaceId = parts[1];
        const packageId = parts[2];
        const couponCode = parts.length > 4 ? parts[4] : null;

        // Fetch package details
        const { data: pkg, error: pkgError } = await supabaseAdmin
          .from("packages")
          .select("plan_id, monthly_job_limit, parallel_job_limit")
          .eq("id", packageId)
          .single();

        if (pkgError || !pkg) {
          console.error("Callback package lookup error:", pkgError);
        } else {
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
          }
          
          // Increment coupon used_count if a coupon was used
          if (couponCode) {
            const { data: coupon } = await supabaseAdmin
              .from("coupons")
              .select("id, used_count")
              .eq("code", couponCode)
              .single();
              
            if (coupon) {
              await supabaseAdmin
                .from("coupons")
                .update({ used_count: coupon.used_count + 1 })
                .eq("id", coupon.id);
            }
          }
        }
      }
    } else {
      console.error("PayTR Error:", params.get("failed_reason_code"), params.get("failed_reason_msg"));
    }

    // PayTR'a işlemin başarıyla alındığını bildirmeliyiz
    return new NextResponse("OK", { status: 200 });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    return new NextResponse("INTERNAL ERROR", { status: 500 });
  }
}
