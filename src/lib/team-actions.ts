"use server";

import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";

// We need a Service Role client to bypass RLS for fetching user emails and inviting users
// since auth.users is not accessible from the public schema.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function getTeamMembers() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  // 1. Fetch memberships for the workspace
  const { data: memberships, error: memError } = await supabaseAdmin
    .from("memberships")
    .select("*")
    .eq("workspace_id", user.workspace.id)
    .order("created_at", { ascending: true });

  if (memError) throw new Error("Failed to fetch memberships");

  // 2. Fetch the corresponding user emails from auth.admin
  // Note: auth.admin.listUsers is paginated, but we can also fetch by IDs.
  // For small to medium workspaces, we can fetch all users and filter, or just map them.
  // A better way is using a Database View, but admin API works out of the box.
  
  const userIds = memberships.map(m => m.user_id);
  const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
  
  if (usersError) throw new Error("Failed to fetch user profiles");

  const usersMap = new Map(users.map(u => [u.id, u]));

  return memberships.map(m => {
    const authUser = usersMap.get(m.user_id);
    return {
      id: m.user_id,
      email: authUser?.email || "Unknown",
      name: authUser?.user_metadata?.full_name || authUser?.email?.split("@")[0] || "User",
      role: m.role,
      joinedAt: m.created_at,
    };
  });
}

export async function inviteMember(email: string, role: string) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  // 1. Send invite email via Supabase Auth Admin
  // (This automatically creates the auth.users record if it doesn't exist)
  const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  if (inviteError) throw new Error(inviteError.message);

  const newUserId = invitedUser.user.id;

  // 2. Insert membership record
  const { error: insertError } = await supabaseAdmin
    .from("memberships")
    .insert({
      workspace_id: user.workspace.id,
      user_id: newUserId,
      role: role,
    });

  if (insertError) {
    // If it conflicts, it means they are already a member or something went wrong
    if (insertError.code === "23505") { // unique violation
      throw new Error("User is already in the workspace");
    }
    throw new Error("Failed to add user to workspace");
  }

  return { success: true };
}

export async function updateMemberRole(targetUserId: string, newRole: string) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  // Prevent removing the last owner or changing own role directly this way
  if (targetUserId === user.id) {
    throw new Error("You cannot change your own role this way");
  }

  const { error } = await supabaseAdmin
    .from("memberships")
    .update({ role: newRole })
    .eq("workspace_id", user.workspace.id)
    .eq("user_id", targetUserId);

  if (error) throw new Error("Failed to update role");
  return { success: true };
}

export async function removeMember(targetUserId: string) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  if (targetUserId === user.id) {
    throw new Error("You cannot remove yourself");
  }

  const { error } = await supabaseAdmin
    .from("memberships")
    .delete()
    .eq("workspace_id", user.workspace.id)
    .eq("user_id", targetUserId);

  if (error) throw new Error("Failed to remove user");
  return { success: true };
}
