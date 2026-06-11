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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
  }
  const { action, ...data } = body;

  try {
    if (action === "create") {
      const slug = normalizeSlug(data.slug || data.name || "plan");
      const pkg = await createPackage({
        slug,
        name: data.name || "",
        description: data.description || "",
        price_kurus: Number(data.price_kurus) || 0,
        currency: "USD",
        billing_period: data.billing_period || "monthly",
        plan_id: slug,
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
      await updatePackage(data.id, normalizePackageUpdates(data.updates || data));
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      if (!data.id) return NextResponse.json({ error: "ID gerekli" }, { status: 400 });
      await deletePackage(data.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bilinmeyen hata" }, { status: 500 });
  }
}

function normalizePackageUpdates(updates: Record<string, unknown>) {
  const normalized = { ...updates };
  const slugSource = typeof normalized.slug === "string" && normalized.slug.trim()
    ? normalized.slug
    : typeof normalized.name === "string"
      ? normalized.name
      : "";
  const slug = normalizeSlug(slugSource);

  if (slug) {
    normalized.slug = slug;
    normalized.plan_id = slug;
  }
  normalized.currency = "USD";
  if (typeof normalized.price_kurus === "number") {
    normalized.price_kurus = Math.max(0, Math.round(normalized.price_kurus));
  }

  return normalized;
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
