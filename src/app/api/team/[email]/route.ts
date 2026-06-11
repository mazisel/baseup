import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(req: Request, { params }: { params: Promise<{ email: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = await params;
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  const decodedEmail = decodeURIComponent(email);

  if (decodedEmail === user.email) {
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const supabase = await createServerClient();

  // Try to delete from invitations first
  await supabase
    .from("workspace_invitations")
    .delete()
    .eq("workspace_id", user.workspace.id)
    .eq("email", decodedEmail);

  // Find user by email
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const targetUser = users.find((u: any) => u.email === decodedEmail);

  if (targetUser) {
    // Delete from memberships
    await supabase
      .from("memberships")
      .delete()
      .eq("workspace_id", user.workspace.id)
      .eq("user_id", targetUser.id);
  }

  return NextResponse.json({ success: true });
}
