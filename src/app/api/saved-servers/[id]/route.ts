import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPreferences } from "@/lib/preferences";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type SavedServerRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  name: string;
  host: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function toSavedServer(row: SavedServerRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by || undefined,
    name: row.name,
    host: row.host,
    lastUsedAt: row.last_used_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const body = await req.json().catch(() => null) as { name?: unknown; host?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const host = normalizeSavedServerHost(body?.host);
  if (!name || !host) {
    return NextResponse.json({
      error: locale === "tr" ? "Sunucu adı ve geçerli host zorunludur." : "Server name and a valid host are required."
    }, { status: 400 });
  }

  const supabase = getSavedServersAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("saved_servers")
    .update({
      name: name.slice(0, 100),
      host,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", user.workspace.id)
    .select("id, workspace_id, created_by, name, host, last_used_at, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({
      error: locale === "tr" ? "Sunucu kaydı bulunamadı." : "Saved server not found."
    }, { status: 404 });
  }

  return NextResponse.json({ server: toSavedServer(data as SavedServerRow) });
}

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

function normalizeSavedServerHost(value: unknown) {
  if (typeof value !== "string") return "";

  const host = value
    .trim()
    .replace(/^ssh:\/\//i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^.*@/, "")
    .toLowerCase();

  if (!host || host.length > 253) return "";
  if (!/^\[?[a-z0-9][a-z0-9:.-]*\]?$/.test(host)) return "";
  return host;
}
