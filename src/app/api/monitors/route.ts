import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkMonitorUrl } from "@/lib/monitor-check";
import { getPreferences } from "@/lib/preferences";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type HealthMonitorRow = {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  status: "pending" | "up" | "down" | "paused";
  last_checked_at: string | null;
  created_at: string;
};

type HealthEventRow = {
  id: string;
  monitor_id: string;
  status: "up" | "down";
  response_time_ms: number | null;
  error_message: string | null;
  created_at: string;
};

function toMonitor(row: HealthMonitorRow, events: HealthEventRow[] = []) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    url: row.url,
    status: row.status,
    lastCheckedAt: row.last_checked_at || undefined,
    createdAt: row.created_at,
    events: events.map(event => ({
      id: event.id,
      monitorId: event.monitor_id,
      status: event.status,
      responseTimeMs: event.response_time_ms ?? undefined,
      errorMessage: event.error_message ?? undefined,
      createdAt: event.created_at,
    })),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Workspace trigger'ı henüz çalışmadıysa "pending" id ile sorgu uuid hatası verir.
  if (user.workspace.id === "pending") {
    return NextResponse.json({ monitors: [] });
  }

  const supabase = getMonitorAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }
  const { data, error } = await supabase
    .from("health_monitors")
    .select("id, workspace_id, name, url, status, last_checked_at, created_at")
    .eq("workspace_id", user.workspace.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const monitorRows = data || [];
  if (monitorRows.length === 0) {
    return NextResponse.json({ monitors: [] });
  }

  const monitorIds = monitorRows.map(monitor => monitor.id);
  const { data: eventRows, error: eventsError } = await supabase
    .from("health_events")
    .select("id, monitor_id, status, response_time_ms, error_message, created_at")
    .in("monitor_id", monitorIds)
    .order("created_at", { ascending: false })
    .limit(Math.max(monitorIds.length * 60, 60));

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 400 });
  }

  const eventsByMonitor = new Map<string, HealthEventRow[]>();
  for (const event of eventRows || []) {
    const group = eventsByMonitor.get(event.monitor_id) || [];
    group.push(event as HealthEventRow);
    eventsByMonitor.set(event.monitor_id, group);
  }

  return NextResponse.json({
    monitors: monitorRows.map(row => toMonitor(row, eventsByMonitor.get(row.id) || [])),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !['owner', 'admin', 'operator'].includes(user.role)) {
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

  const body = await req.json().catch(() => null) as { name?: unknown; url?: unknown } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({
      error: locale === "tr" ? "Geçersiz istek gövdesi" : "Invalid request body"
    }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({
      error: locale === "tr" ? "Monitör adı ve URL zorunludur" : "Monitor name and URL are required"
    }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({
      error: locale === "tr" ? "Monitör adı çok uzun (en fazla 100 karakter)" : "Monitor name is too long (max 100 characters)"
    }, { status: 400 });
  }

  const normalizedUrl = normalizeMonitorUrl(body.url);
  if (!normalizedUrl) {
    return NextResponse.json({
      error: locale === "tr"
        ? "Geçerli bir http(s) adresi girin. İç ağ ve localhost adresleri izlenemez."
        : "Enter a valid http(s) URL. Private network and localhost addresses cannot be monitored."
    }, { status: 400 });
  }

  const supabase = getMonitorAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  // Check limit (Trial = 1, Growth = 3, Scale = 10)
  const limits: Record<string, number> = { trial: 1, growth: 3, scale: 10 };
  const limit = limits[user.plan] || 1;

  const { count } = await supabase
    .from("health_monitors")
    .select("*", { count: 'exact', head: true })
    .eq("workspace_id", user.workspace.id);

  if (count !== null && count >= limit) {
    return NextResponse.json({
      error: locale === "tr"
        ? `${user.plan} planındaki ${limit} monitör limitinize ulaştınız. Daha fazlası için planınızı yükseltin.`
        : `You have reached your limit of ${limit} monitors for the ${user.plan} plan.`
    }, { status: 403 });
  }

  const initialCheck = await checkMonitorUrl(normalizedUrl);

  const { data, error } = await supabase
    .from("health_monitors")
    .insert({
      workspace_id: user.workspace.id,
      name,
      url: normalizedUrl,
      status: initialCheck.status,
      last_checked_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error: eventError } = await supabase.from("health_events").insert({
    monitor_id: data.id,
    status: initialCheck.status,
    response_time_ms: initialCheck.responseTimeMs,
    error_message: initialCheck.errorMessage,
  });
  if (eventError) {
    console.error("[api/monitors] İlk sağlık olayı yazılamadı:", eventError.message);
  }

  return NextResponse.json({ monitor: toMonitor(data) });
}

function normalizeMonitorUrl(value: unknown) {
  if (typeof value !== "string") return "";

  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (isPrivateHost(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
  if (host.startsWith("169.254.") || host.startsWith("0.")) return true;

  // IPv6: loopback, link-local (fe80::/10), unique-local (fc00::/7) ve IPv4-mapped adresler
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    if (host.startsWith("::ffff:")) return true;
  }

  const parts = host.split(".").map(part => Number(part));
  if (parts.length === 4 && parts.every(part => Number.isInteger(part))) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }

  return false;
}

function getMonitorAdminClient() {
  try {
    return getSupabaseAdminClient();
  } catch (error) {
    console.error("Monitors API admin client error", error);
    return null;
  }
}
