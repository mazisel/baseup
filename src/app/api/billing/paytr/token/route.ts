import { NextResponse } from "next/server";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/auth";

import { createClient } from "@supabase/supabase-js";

const PAYTR_MERCHANT_ID = process.env.PAYTR_MERCHANT_ID || "test_merchant_id";
const PAYTR_MERCHANT_KEY = process.env.PAYTR_MERCHANT_KEY || "test_merchant_key";
const PAYTR_MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT || "test_merchant_salt";

// Service role to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { packageId, couponCode } = await request.json(); // Accept optional couponCode
    if (!packageId) {
      return NextResponse.json({ error: "Invalid package" }, { status: 400 });
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

    let payment_amount = pkg.price_kurus; // Kuruş cinsinden

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
        }
      }
    }

    // OID format: ORDER_{workspaceId}_{packageId}_{timestamp}_{couponCode(optional)}
    const merchant_oid = `ORDER_${user.workspace.id}_${pkg.id}_${Date.now()}${couponCode ? '_' + couponCode : ''}`;
    const user_name = user.name;
    const user_address = "Adres Belirtilmedi"; // Dijital servis
    const user_phone = "05555555555";
    const email = user.email;
    const user_ip = request.headers.get("x-forwarded-for") || "127.0.0.1";
    const currency = "TL";
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
      body: formData.toString()
    });

    const result = await response.json();

    if (result.status === "success") {
      return NextResponse.json({ token: result.token });
    } else {
      console.error("PayTR Token Error:", result.reason);
      return NextResponse.json({ error: result.reason }, { status: 500 });
    }

  } catch (error: any) {
    console.error("PayTR Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
