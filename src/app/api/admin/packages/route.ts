import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail, getAdminPackages, createPackage, updatePackage, deletePackage } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const packages = await getAdminPackages();
  return NextResponse.json({ packages });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const { action, ...data } = body;

  try {
    if (action === "create") {
      const pkg = await createPackage({
        slug: data.slug || "",
        name: data.name || "",
        description: data.description || "",
        price_kurus: Number(data.price_kurus) || 0,
        currency: data.currency || "TL",
        billing_period: data.billing_period || "monthly",
        plan_id: data.plan_id || "growth",
        monthly_job_limit: Number(data.monthly_job_limit) || 50,
        parallel_job_limit: Number(data.parallel_job_limit) || 2,
        features: data.features || [],
        is_active: data.is_active !== false,
        sort_order: Number(data.sort_order) || 0,
      });
      return NextResponse.json({ package: pkg }, { status: 201 });
    }

    if (action === "update") {
      if (!data.id) return NextResponse.json({ error: "ID gerekli" }, { status: 400 });
      await updatePackage(data.id, data.updates || {});
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      if (!data.id) return NextResponse.json({ error: "ID gerekli" }, { status: 400 });
      await deletePackage(data.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
