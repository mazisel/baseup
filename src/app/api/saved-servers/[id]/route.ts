import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["owner", "admin", "operator"].includes(user.role)) {
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

  const { id } = await params;
  if (!id) {
    return NextResponse.json({
      error: locale === "tr" ? "Geçersiz sunucu kaydı." : "Invalid saved server."
    }, { status: 400 });
  }

  const supabase = getSavedServersAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { error } = await supabase
    .from("saved_servers")
    .delete()
    .eq("id", id)
    .eq("workspace_id", user.workspace.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

function getSavedServersAdminClient() {
  try {
    return getSupabaseAdminClient();
  } catch (error) {
    console.error("Saved servers API admin client error", error);
    return null;
  }
}
