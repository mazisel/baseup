import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser, MembershipRole } from "@/types/domain";

const MEMBERSHIP_ROLES: MembershipRole[] = ["owner", "admin", "operator", "viewer"];

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const membershipSelect = `
    role,
    workspaces (
      id,
      name,
      slug,
      entitlements (
        plan,
        monthly_job_limit,
        parallel_job_limit
      )
    )
  `;

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select(membershipSelect)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let resolvedMembership = membership;

  if (membershipError) {
    try {
      const supabaseAdmin = getSupabaseAdminClient();
      const { data: adminMembership, error: adminMembershipError } = await supabaseAdmin
        .from("memberships")
        .select(membershipSelect)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (adminMembershipError) {
        throw adminMembershipError;
      }
      resolvedMembership = adminMembership;
    } catch (error) {
      console.error("Failed to fetch membership", error);
      return null;
    }
  }

  if (!resolvedMembership || !resolvedMembership.workspaces) {
    // Edge case: Trigger hasn't finished or user has no workspace
    return {
      id: user.id,
      email: user.email!,
      name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
      workspace: {
        id: "pending",
        name: "Pending Workspace",
        slug: "pending",
      },
      role: "owner",
      plan: "trial",
      monthlyJobLimit: 10,
      parallelJobLimit: 1,
    };
  }

  const workspace = Array.isArray(resolvedMembership.workspaces)
    ? resolvedMembership.workspaces[0]
    : resolvedMembership.workspaces;
  
  const entitlements = Array.isArray(workspace.entitlements)
    ? workspace.entitlements[0]
    : workspace.entitlements;
  const role = MEMBERSHIP_ROLES.includes(resolvedMembership.role as MembershipRole)
    ? resolvedMembership.role as MembershipRole
    : "viewer";
  const plan = typeof entitlements?.plan === "string" && entitlements.plan.trim()
    ? entitlements.plan
    : "trial";

  return {
    id: user.id,
    email: user.email!,
    name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },
    role,
    plan,
    monthlyJobLimit: entitlements?.monthly_job_limit ?? 10,
    parallelJobLimit: entitlements?.parallel_job_limit ?? 1,
  };
}
