import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function DELETE(req: Request, { params }: { params: Promise<{ email: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { locale } = await getPreferences();
  const { email } = await params;
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const decodedEmail = decodeURIComponent(email).trim().toLowerCase();

  if (decodedEmail === user.email.toLowerCase()) {
    return NextResponse.json({
      error: locale === "tr" ? "Kendinizi çıkaramazsınız." : "You cannot remove yourself."
    }, { status: 400 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdminClient();
  } catch (error) {
    console.error("[api/team] Admin client error:", error);
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const supabase = await createServerClient();

  // Try to delete from invitations first
  const { error: inviteDeleteError } = await supabase
    .from("workspace_invitations")
    .delete()
    .eq("workspace_id", user.workspace.id)
    .eq("email", decodedEmail);

  if (inviteDeleteError) {
    return NextResponse.json({ error: inviteDeleteError.message }, { status: 400 });
  }

  // Find user by email (case-insensitive)
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const targetUser = usersData?.users.find(u => (u.email || "").toLowerCase() === decodedEmail);

  if (targetUser) {
    // Workspace sahibi bu uç üzerinden çıkarılamaz; admin'in owner'ı atmasını engelle.
    const { data: targetMembership } = await supabaseAdmin
      .from("memberships")
      .select("role")
      .eq("workspace_id", user.workspace.id)
      .eq("user_id", targetUser.id)
      .maybeSingle();

    if (targetMembership?.role === "owner") {
      return NextResponse.json({
        error: locale === "tr" ? "Workspace sahibi çıkarılamaz." : "The workspace owner cannot be removed."
      }, { status: 403 });
    }

    // Delete from memberships
    const { error: memberDeleteError } = await supabase
      .from("memberships")
      .delete()
      .eq("workspace_id", user.workspace.id)
      .eq("user_id", targetUser.id);

    if (memberDeleteError) {
      return NextResponse.json({ error: memberDeleteError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
