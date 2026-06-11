import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { code, packageId } = await request.json();

    if (!code || !packageId) {
      return NextResponse.json({ error: "Eksik parametre" }, { status: 400 });
    }

    // Paket fiyatını al
    const { data: pkg, error: pkgError } = await supabase
      .from("packages")
      .select("price_kurus")
      .eq("id", packageId)
      .eq("is_active", true)
      .single();

    if (pkgError || !pkg) {
      return NextResponse.json({ error: "Geçersiz paket" }, { status: 404 });
    }

    // Kuponu kontrol et
    const { data: coupon, error: couponError } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", code)
      .eq("is_active", true)
      .single();

    if (couponError || !coupon) {
      return NextResponse.json({ error: "Geçersiz veya süresi dolmuş kupon kodu" }, { status: 404 });
    }

    // Süre kontrolü
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return NextResponse.json({ error: "Bu kuponun kullanım süresi dolmuş" }, { status: 400 });
    }

    // Limit kontrolü
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return NextResponse.json({ error: "Bu kuponun kullanım limiti dolmuş" }, { status: 400 });
    }

    // İndirim hesaplama
    let originalPrice = pkg.price_kurus;
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
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
