"use server";

import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Locale } from "@/lib/preference-shared";

// Davet edilebilir / atanabilir roller. "owner" bilinçli olarak yok:
// sahiplik devri bu akış üzerinden yapılamaz.
const ASSIGNABLE_ROLES = ["admin", "operator", "viewer"];

function t(locale: Locale, tr: string, en: string) {
  return locale === "tr" ? tr : en;
}

export async function getTeamMembers() {
  const user = await getCurrentUser();
  const { locale } = await getPreferences();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error(t(locale, "Bu işlem için yetkiniz yok.", "You are not allowed to perform this action."));
  }
  if (user.workspace.id === "pending") {
    return [];
  }
  const supabaseAdmin = getSupabaseAdminClient();

  // 1. Fetch memberships for the workspace
  const { data: memberships, error: memError } = await supabaseAdmin
    .from("memberships")
    .select("*")
    .eq("workspace_id", user.workspace.id)
    .order("created_at", { ascending: true });

  if (memError) {
    throw new Error(t(locale, `Üyelikler alınamadı: ${memError.message}`, `Failed to fetch memberships: ${memError.message}`));
  }

  // 2. Fetch the corresponding user emails from auth.admin
  const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (usersError) {
    throw new Error(t(locale, "Kullanıcı profilleri alınamadı.", "Failed to fetch user profiles."));
  }

  const usersMap = new Map(usersData.users.map(u => [u.id, u]));

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
  const { locale } = await getPreferences();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error(t(locale, "Bu işlem için yetkiniz yok.", "You are not allowed to perform this action."));
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new Error(t(locale, "Geçersiz rol.", "Invalid role."));
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    throw new Error(t(locale, "Geçerli bir e-posta adresi girin.", "Enter a valid email address."));
  }
  const supabaseAdmin = getSupabaseAdminClient();

  // Kullanıcı zaten kayıtlıysa inviteUserByEmail hata verir; önce mevcut
  // kullanıcıyı arayıp varsa doğrudan üyelik ekle.
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = usersData?.users.find(u => (u.email || "").toLowerCase() === normalizedEmail);

  let newUserId: string;
  if (existingUser) {
    newUserId = existingUser.id;
  } else {
    // Send invite email via Supabase Auth Admin
    // (This automatically creates the auth.users record)
    const { data: invitedUser, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail);
    if (inviteError) throw new Error(inviteError.message);
    newUserId = invitedUser.user.id;
  }

  // Insert membership record
  const { error: insertError } = await supabaseAdmin
    .from("memberships")
    .insert({
      workspace_id: user.workspace.id,
      user_id: newUserId,
      role: role,
    });

  if (insertError) {
    if (insertError.code === "23505") { // unique violation
      throw new Error(t(locale, "Bu kullanıcı zaten çalışma alanında.", "User is already in the workspace."));
    }
    throw new Error(t(locale, "Kullanıcı çalışma alanına eklenemedi.", "Failed to add user to the workspace."));
  }

  return { success: true };
}

export async function updateMemberRole(targetUserId: string, newRole: string) {
  const user = await getCurrentUser();
  const { locale } = await getPreferences();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error(t(locale, "Bu işlem için yetkiniz yok.", "You are not allowed to perform this action."));
  }
  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    throw new Error(t(locale, "Geçersiz rol.", "Invalid role."));
  }
  const supabaseAdmin = getSupabaseAdminClient();

  // Prevent removing the last owner or changing own role directly this way
  if (targetUserId === user.id) {
    throw new Error(t(locale, "Kendi rolünüzü bu şekilde değiştiremezsiniz.", "You cannot change your own role this way."));
  }

  const targetRole = await getMemberRole(targetUserId, user.workspace.id);
  if (targetRole === "owner") {
    throw new Error(t(locale, "Workspace sahibinin rolü değiştirilemez.", "The workspace owner's role cannot be changed."));
  }

  const { error } = await supabaseAdmin
    .from("memberships")
    .update({ role: newRole })
    .eq("workspace_id", user.workspace.id)
    .eq("user_id", targetUserId);

  if (error) throw new Error(t(locale, "Rol güncellenemedi.", "Failed to update the role."));
  return { success: true };
}

export async function removeMember(targetUserId: string) {
  const user = await getCurrentUser();
  const { locale } = await getPreferences();
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Error(t(locale, "Bu işlem için yetkiniz yok.", "You are not allowed to perform this action."));
  }
  const supabaseAdmin = getSupabaseAdminClient();

  if (targetUserId === user.id) {
    throw new Error(t(locale, "Kendinizi çıkaramazsınız.", "You cannot remove yourself."));
  }

  const targetRole = await getMemberRole(targetUserId, user.workspace.id);
  if (targetRole === "owner") {
    throw new Error(t(locale, "Workspace sahibi çıkarılamaz.", "The workspace owner cannot be removed."));
  }

  const { error } = await supabaseAdmin
    .from("memberships")
    .delete()
    .eq("workspace_id", user.workspace.id)
    .eq("user_id", targetUserId);

  if (error) throw new Error(t(locale, "Kullanıcı kaldırılamadı.", "Failed to remove the user."));
  return { success: true };
}

async function getMemberRole(targetUserId: string, workspaceId: string) {
  const supabaseAdmin = getSupabaseAdminClient();
  const { data } = await supabaseAdmin
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  return data?.role as string | undefined;
}
