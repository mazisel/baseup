import { createClient } from "@/lib/supabase/server";
import type { AppUser } from "@/types/domain";

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select(`
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
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!membership || !membership.workspaces) {
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

  const workspace = Array.isArray(membership.workspaces)
    ? membership.workspaces[0]
    : membership.workspaces;
  
  const entitlements = Array.isArray(workspace.entitlements)
    ? workspace.entitlements[0]
    : workspace.entitlements;

  return {
    id: user.id,
    email: user.email!,
    name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },
    role: membership.role as any,
    plan: (entitlements?.plan || "trial") as any,
    monthlyJobLimit: entitlements?.monthly_job_limit ?? 10,
    parallelJobLimit: entitlements?.parallel_job_limit ?? 1,
  };
}
