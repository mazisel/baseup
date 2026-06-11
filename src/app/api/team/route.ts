import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServerClient();

  // Get active members
  const { data: memberships, error: mError } = await supabase
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("workspace_id", user.workspace.id);

  if (mError) return NextResponse.json({ error: mError.message }, { status: 400 });

  // Get emails for the user_ids (requires service_role)
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const activeMembers = [];
  for (const m of memberships || []) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
    activeMembers.push({
      id: m.user_id,
      email: authUser?.user?.email || "Unknown",
      role: m.role,
      status: "active",
      createdAt: m.created_at,
    });
  }

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

  const { email, role } = await req.json();
  if (!email || !role || !["admin", "operator", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Search for the user by email
  // Supabase admin api doesn't have getUserByEmail, we list users and find
  // Note: For a very large user base, we'd use a search, but listUsers has pagination.
  // We can just try to inviteUserByEmail. If it fails because user exists, it's fine.
  // Actually, we can use an internal RPC or just insert into invitations and let handle_new_user do the rest.
  // Let's just insert into workspace_invitations. If they already exist, we can manually check memberships later.
  // Let's write a simple approach: just insert into invitations. Wait, if they already exist, the trigger won't run.
  
  // Let's use the API to list users (with search query)
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = users.find((u: any) => u.email === email);

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
