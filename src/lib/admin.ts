import { createClient } from "@supabase/supabase-js";

// Admin-only Supabase client (service role)
// Fallback değerler build sırasında modül yüklenebilsin diye (env o anda boş)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// ── Dashboard Stats ──
export async function getAdminStats() {
  const [
    { count: totalUsers },
    { count: totalWorkspaces },
    { count: totalJobs },
    { count: runningJobs },
    { count: failedJobs },
  ] = await Promise.all([
    supabaseAdmin.from("memberships").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("workspaces").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("job_runs").select("*", { count: "exact", head: true }),
    supabaseAdmin.from("job_runs").select("*", { count: "exact", head: true }).in("status", ["running", "queued"]),
    supabaseAdmin.from("job_runs").select("*", { count: "exact", head: true }).eq("status", "error"),
  ]);

  // Son 24 saat işleri
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: last24h } = await supabaseAdmin
    .from("job_runs")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since);

  return {
    totalUsers: totalUsers || 0,
    totalWorkspaces: totalWorkspaces || 0,
    totalJobs: totalJobs || 0,
    runningJobs: runningJobs || 0,
    failedJobs: failedJobs || 0,
    last24h: last24h || 0,
  };
}

// ── Users ──
export async function getAdminUsers() {
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;

  // Fetch memberships to join workspace + role
  const { data: memberships } = await supabaseAdmin
    .from("memberships")
    .select("user_id, role, workspace_id, workspaces(name, slug), created_at");

  type MembershipRow = NonNullable<typeof memberships>[number];
  const membershipMap = new Map<string, MembershipRow>();
  for (const m of memberships || []) {
    membershipMap.set(m.user_id, m);
  }

  // Fetch entitlements
  const { data: entitlements } = await supabaseAdmin.from("entitlements").select("workspace_id, plan");
  const planMap = new Map<string, string>();
  for (const e of entitlements || []) {
    planMap.set(e.workspace_id, e.plan);
  }

  return users.map(u => {
    const m = membershipMap.get(u.id);
    const ws = m?.workspaces ? (Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces) : null;
    return {
      id: u.id,
      email: u.email || "",
      name: u.user_metadata?.full_name || u.email?.split("@")[0] || "User",
      role: m?.role || "—",
      workspaceName: ws?.name || "—",
      workspaceId: m?.workspace_id || null,
      plan: m?.workspace_id ? (planMap.get(m.workspace_id) || "trial") : "—",
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at || null,
    };
  });
}

// ── Workspaces ──
export async function getAdminWorkspaces() {
  const { data: workspaces } = await supabaseAdmin
    .from("workspaces")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });

  const { data: entitlements } = await supabaseAdmin.from("entitlements").select("workspace_id, plan, monthly_job_limit, parallel_job_limit");
  type EntitlementRow = NonNullable<typeof entitlements>[number];
  const planMap = new Map<string, EntitlementRow>();
  for (const e of entitlements || []) {
    planMap.set(e.workspace_id, e);
  }

  const { data: memberCounts } = await supabaseAdmin.from("memberships").select("workspace_id");
  const countMap = new Map<string, number>();
  for (const m of memberCounts || []) {
    countMap.set(m.workspace_id, (countMap.get(m.workspace_id) || 0) + 1);
  }

  const { data: jobCounts } = await supabaseAdmin.from("job_runs").select("workspace_id");
  const jobCountMap = new Map<string, number>();
  for (const j of jobCounts || []) {
    jobCountMap.set(j.workspace_id, (jobCountMap.get(j.workspace_id) || 0) + 1);
  }

  return (workspaces || []).map(ws => {
    const ent = planMap.get(ws.id);
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      plan: ent?.plan || "trial",
      monthlyJobLimit: ent?.monthly_job_limit || 10,
      parallelJobLimit: ent?.parallel_job_limit || 1,
      memberCount: countMap.get(ws.id) || 0,
      jobCount: jobCountMap.get(ws.id) || 0,
      createdAt: ws.created_at,
    };
  });
}

// ── Jobs ──
export async function getAdminJobs(limit = 100) {
  const { data: jobs } = await supabaseAdmin
    .from("job_runs")
    .select("id, workspace_id, created_by, type, title, status, usage_units, created_at, started_at, finished_at, error_message")
    .order("created_at", { ascending: false })
    .limit(limit);

  // Map workspace names
  const wsIds = [...new Set((jobs || []).map(j => j.workspace_id))];
  const { data: workspaces } = await supabaseAdmin.from("workspaces").select("id, name").in("id", wsIds);
  const wsMap = new Map<string, string>();
  for (const ws of workspaces || []) {
    wsMap.set(ws.id, ws.name);
  }

  return (jobs || []).map(j => ({
    id: j.id,
    workspaceName: wsMap.get(j.workspace_id) || "—",
    type: j.type,
    title: j.title,
    status: j.status,
    usageUnits: j.usage_units,
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
    errorMessage: j.error_message,
  }));
}

// ── Plan Update ──
export async function updateWorkspacePlan(workspaceId: string, plan: string) {
  const limits: Record<string, { monthly: number; parallel: number }> = {
    trial: { monthly: 10, parallel: 1 },
    growth: { monthly: 100, parallel: 3 },
    scale: { monthly: 500, parallel: 10 },
  };

  const l = limits[plan] || limits.trial;

  const { error } = await supabaseAdmin
    .from("entitlements")
    .update({
      plan,
      monthly_job_limit: l.monthly,
      parallel_job_limit: l.parallel,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);

  if (error) throw error;
  return { success: true };
}

// ── Packages CRUD ──
export type Package = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price_kurus: number;
  currency: string;
  billing_period: string;
  plan_id: string;
  monthly_job_limit: number;
  parallel_job_limit: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export async function getAdminPackages(): Promise<Package[]> {
  const { data, error } = await supabaseAdmin
    .from("packages")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data || []) as Package[];
}

export async function createPackage(pkg: Omit<Package, "id" | "created_at" | "updated_at">) {
  const { data, error } = await supabaseAdmin
    .from("packages")
    .insert({
      slug: pkg.slug,
      name: pkg.name,
      description: pkg.description,
      price_kurus: pkg.price_kurus,
      currency: pkg.currency,
      billing_period: pkg.billing_period,
      plan_id: pkg.plan_id,
      monthly_job_limit: pkg.monthly_job_limit,
      parallel_job_limit: pkg.parallel_job_limit,
      features: pkg.features,
      is_active: pkg.is_active,
      sort_order: pkg.sort_order,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updatePackage(id: string, updates: Partial<Omit<Package, "id" | "created_at">>) {
  const { error } = await supabaseAdmin
    .from("packages")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
  return { success: true };
}

export async function deletePackage(id: string) {
  const { error } = await supabaseAdmin
    .from("packages")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return { success: true };
}

// ── Coupons CRUD ──
export type Coupon = {
  id: string;
  code: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function getAdminCoupons(): Promise<Coupon[]> {
  const { data, error } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as Coupon[];
}

export async function createCoupon(coupon: Omit<Coupon, "id" | "used_count" | "created_at" | "updated_at">) {
  const { data, error } = await supabaseAdmin
    .from("coupons")
    .insert({
      code: coupon.code.toUpperCase(),
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      max_uses: coupon.max_uses,
      expires_at: coupon.expires_at,
      is_active: coupon.is_active,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCoupon(id: string, updates: Partial<Omit<Coupon, "id" | "created_at">>) {
  if (updates.code) updates.code = updates.code.toUpperCase();
  
  const { error } = await supabaseAdmin
    .from("coupons")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
  return { success: true };
}

export async function deleteCoupon(id: string) {
  const { error } = await supabaseAdmin
    .from("coupons")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return { success: true };
}
