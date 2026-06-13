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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (user.workspace.id === "pending") {
    return NextResponse.json({ servers: [] });
  }

  const supabase = getSavedServersAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("saved_servers")
    .select("id, workspace_id, created_by, name, host, last_used_at, created_at, updated_at")
    .eq("workspace_id", user.workspace.id)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ servers: (data || []).map(row => toSavedServer(row as SavedServerRow)) });
}

export async function POST(req: Request) {
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

  const body = await req.json().catch(() => null) as { name?: unknown; host?: unknown } | null;
  const host = normalizeSavedServerHost(body?.host);
  if (!host) {
    return NextResponse.json({
      error: locale === "tr" ? "Geçerli bir sunucu adresi girin." : "Enter a valid server address."
    }, { status: 400 });
  }

  const requestedName = typeof body?.name === "string" ? body.name.trim() : "";
  const name = (requestedName || host).slice(0, 100);
  const now = new Date().toISOString();
  const supabase = getSavedServersAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("saved_servers")
    .upsert({
      workspace_id: user.workspace.id,
      created_by: user.id,
      name,
      host,
      last_used_at: now,
      updated_at: now,
    }, {
      onConflict: "workspace_id,host",
    })
    .select("id, workspace_id, created_by, name, host, last_used_at, created_at, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({
      error: error?.message || (locale === "tr" ? "Sunucu kaydedilemedi." : "Could not save the server.")
    }, { status: 400 });
  }

  return NextResponse.json({ server: toSavedServer(data as SavedServerRow) }, { status: 201 });
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

function getSavedServersAdminClient() {
  try {
    return getSupabaseAdminClient();
  } catch (error) {
    console.error("Saved servers API admin client error", error);
    return null;
  }
}
