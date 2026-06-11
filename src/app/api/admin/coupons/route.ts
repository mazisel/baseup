import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail, getAdminCoupons, createCoupon, updateCoupon, deleteCoupon } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const coupons = await getAdminCoupons();
  return NextResponse.json({ coupons });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
  }
  const { action, ...data } = body;

  try {
    if (action === "create") {
      const coupon = await createCoupon({
        code: data.code || "",
        discount_type: data.discount_type || "percentage",
        discount_value: Number(data.discount_value) || 0,
        max_uses: data.max_uses ? Number(data.max_uses) : null,
        expires_at: data.expires_at || null,
        is_active: data.is_active !== false,
      });
      return NextResponse.json({ coupon }, { status: 201 });
    }

    if (action === "update") {
      if (!data.id) return NextResponse.json({ error: "ID gerekli" }, { status: 400 });
      await updateCoupon(data.id, data.updates || {});
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      if (!data.id) return NextResponse.json({ error: "ID gerekli" }, { status: 400 });
      await deleteCoupon(data.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bilinmeyen hata" }, { status: 500 });
  }
}
