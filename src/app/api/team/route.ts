import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (user.workspace.id === "pending") {
    return NextResponse.json({ members: [] });
  }

  const supabase = await createServerClient();

  // Get active members
  const { data: memberships, error: mError } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("workspace_id", user.workspace.id);

  if (mError) return NextResponse.json({ error: mError.message }, { status: 400 });

  // Get emails for the user_ids (requires service_role).
  // Tek listUsers çağrısı: üye başına ayrı admin isteği (N+1) atma.
  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdminClient();
  } catch (error) {
    console.error("[api/team] Admin client error:", error);
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) {
    return NextResponse.json({ error: "Failed to fetch user profiles" }, { status: 500 });
  }
  const usersMap = new Map(usersData.users.map(u => [u.id, u]));

  const activeMembers = (memberships || []).map(m => {
    const authUser = usersMap.get(m.user_id);
    return {
      id: m.user_id,
      email: authUser?.email || "Unknown",
      role: m.role,
      status: "active",
      createdAt: m.created_at,
    };
  });

  // Get pending invitations
  const { data: invitations, error: iError } = await supabase
    .from("workspace_invitations")
    .select("id, email, role, created_at")
    .eq("workspace_id", user.workspace.id);

  if (iError) return NextResponse.json({ error: iError.message }, { status: 400 });

  const pendingMembers = (invitations || []).map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: "pending",
    createdAt: inv.created_at,
  }));

  return NextResponse.json({ members: [...activeMembers, ...pendingMembers] });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { locale } = await getPreferences();
  if (user.workspace.id === "pending") {
    return NextResponse.json({
      error: locale === "tr"
        ? "Çalışma alanınız henüz hazırlanıyor. Lütfen birkaç saniye sonra tekrar deneyin."
        : "Your workspace is still being prepared. Please try again in a few seconds."
    }, { status: 409 });
  }

  const body = await req.json().catch(() => null) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (!email || !email.includes("@") || !["admin", "operator", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdminClient();
  } catch (error) {
    console.error("[api/team] Admin client error:", error);
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  // Search for the user by email (case-insensitive). listUsers sayfalıdır;
  // ilk 1000 kullanıcıyı tarar — bulunamazsa davet akışına düşer.
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = usersData?.users.find(u => (u.email || "").toLowerCase() === email);

  const supabase = await createServerClient();

  if (existingUser) {
    // Insert directly into memberships
    const { error } = await supabase
      .from("memberships")
      .insert({
        workspace_id: user.workspace.id,
        user_id: existingUser.id,
        role: role
      });

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: "User is already a member" }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  } else {
    // Insert into workspace_invitations
    const { error } = await supabase
      .from("workspace_invitations")
      .insert({
        workspace_id: user.workspace.id,
        email: email,
        role: role
      });

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: "An invitation is already pending for this email" }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
