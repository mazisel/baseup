import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-key"
);

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { locale } = await getPreferences();

    // Kupon kodu brute-force denemelerini yavaşlat
    const { ok } = rateLimit(`coupon:${user.id}`);
    if (!ok) {
      return NextResponse.json(
        { error: locale === "tr" ? "Çok fazla deneme yaptınız. Lütfen biraz bekleyin." : "Too many attempts. Please wait a moment." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const body = await request.json().catch(() => null) as { code?: string; packageId?: string } | null;
    const code = body?.code;
    const packageId = body?.packageId;

    if (!code || !packageId) {
      return NextResponse.json({ error: locale === "tr" ? "Eksik parametre" : "Missing parameters" }, { status: 400 });
    }

    // Plan fiyatını al
    const { data: pkg, error: pkgError } = await supabase
      .from("packages")
      .select("price_kurus, currency")
      .eq("id", packageId)
      .eq("is_active", true)
      .single();

    if (pkgError || !pkg) {
      return NextResponse.json({ error: locale === "tr" ? "Geçersiz plan" : "Invalid plan" }, { status: 404 });
    }

    // Kuponu kontrol et
    const { data: coupon, error: couponError } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", code)
      .eq("is_active", true)
      .single();

    if (couponError || !coupon) {
      return NextResponse.json({
        error: locale === "tr" ? "Geçersiz veya süresi dolmuş kupon kodu" : "Invalid or expired coupon code"
      }, { status: 404 });
    }

    // Süre kontrolü
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return NextResponse.json({
        error: locale === "tr" ? "Bu kuponun kullanım süresi dolmuş" : "This coupon has expired"
      }, { status: 400 });
    }

    // Limit kontrolü
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return NextResponse.json({
        error: locale === "tr" ? "Bu kuponun kullanım limiti dolmuş" : "This coupon has reached its usage limit"
      }, { status: 400 });
    }

    // İndirim hesaplama
    const originalPrice = pkg.price_kurus;
    let finalPrice = originalPrice;
    let discountAmount = 0;

    if (coupon.discount_type === "percentage") {
      discountAmount = Math.floor(originalPrice * (coupon.discount_value / 100));
      finalPrice = originalPrice - discountAmount;
    } else if (coupon.discount_type === "fixed") {
      discountAmount = coupon.discount_value;
      finalPrice = originalPrice - discountAmount;
    }

    if (finalPrice < 0) finalPrice = 0;

    return NextResponse.json({
      valid: true,
      originalPrice,
      finalPrice,
      discountAmount,
      currency: pkg.currency || "USD",
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value
    });

  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bilinmeyen hata" }, { status: 500 });
  }
}
