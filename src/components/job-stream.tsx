"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, KeyRound, Copy, Check, ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { getCopy } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { getModules } from "@/lib/constants";
import type { Locale } from "@/lib/preference-shared";
import type { JobRun } from "@/types/domain";

// job_events / job_runs tablolarından gelen satır şekilleri (snake_case)
type JobEventRow = {
  id: string;
  job_id: string;
  level: string;
  message: string;
  created_at: string;
};

type JobRunRow = {
  status: JobRun["status"];
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
};

export function JobStream({ initialJob, locale }: { initialJob: JobRun; locale: Locale }) {
  const [job, setJob] = useState(initialJob);
  const [logs, setLogs] = useState<JobEventRow[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const logShellRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const cursorRef = useRef<string | null>(null);
  const copy = getCopy(locale);
  const supabase = useMemo(() => createClient(), []);

  const isTerminal = job.status === "success" || job.status === "error" || job.status === "cancelled";

  // Supabase Realtime yoğun log akışında mesaj düşürdüğü için canlı akış "donuyordu".
  // Bunun yerine job_events'i kısa aralıklarla artımlı olarak çekiyoruz (id ile tekilleştirme):
  // garantili, sıralı ve gerçek zamanlıya yakın. İş bitince son bir tam çekim daha yapılır.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      // Yalnızca son imleçten sonraki olayları çek (artımlı). Aynı saniyedeki
      // satırların kaçmaması için gte + id ile tekilleştirme kullanılır.
      let query = supabase
        .from("job_events")
        .select("*")
        .eq("job_id", initialJob.id)
        .order("created_at", { ascending: true });
      if (cursorRef.current) query = query.gte("created_at", cursorRef.current);

      const { data: events } = await query;

      if (cancelled) return;

      if (events && events.length) {
        const seen = seenIdsRef.current;
        const fresh = (events as JobEventRow[]).filter(e => !seen.has(e.id));
        if (fresh.length) {
          fresh.forEach(e => seen.add(e.id));
          cursorRef.current = fresh[fresh.length - 1].created_at;
          setLogs(current => [...current, ...fresh]);
        }
      }

      // İş durumunu da güncelle (running → success/error geçişini yakala)
      const { data: jobRow } = await supabase
        .from("job_runs")
        .select("status, updated_at, started_at, finished_at, error_message")
        .eq("id", initialJob.id)
        .maybeSingle();

      if (cancelled) return;

      let terminalNow = false;
      if (jobRow) {
        const row = jobRow as JobRunRow;
        terminalNow = row.status === "success" || row.status === "error" || row.status === "cancelled";
        setJob(prev => ({
          ...prev,
          status: row.status,
          updatedAt: row.updated_at,
          startedAt: row.started_at ?? undefined,
          finishedAt: row.finished_at ?? undefined,
          errorMessage: row.error_message ?? undefined,
        }));
      }

      // İş bittiyse polling'i durdur; çalışıyorsa 1.5 sn sonra tekrar çek.
      if (!terminalNow && !cancelled) {
        timer = setTimeout(poll, 1_500);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [initialJob.id, supabase]);

  useEffect(() => {
    const shell = logShellRef.current;
    if (!shell) return;
    shell.scrollTop = shell.scrollHeight;
  }, [logs]);

  const currentStage = useMemo(() => getCurrentStage(logs), [logs]);
  const credentials = useMemo(() => extractCredentials(logs), [logs]);

  const summaryItems = useMemo(() => {
    return [
      [copy.job.summary.runner, job.summary?.runnerMode],
      [copy.job.summary.source, job.summary?.source || "-"],
      [copy.job.summary.target, job.summary?.target || "-"],
      [copy.job.summary.instance, job.summary?.targetInstance || "1"],
      [copy.job.summary.scope, formatFlags(job.summary?.flags, locale)]
    ];
  }, [copy.job.summary.instance, copy.job.summary.runner, copy.job.summary.scope, copy.job.summary.source, copy.job.summary.target, job.summary, locale]);

  async function retry() {
    setRetrying(true);
    setRetryError("");
    try {
      const response = await fetch(`/api/jobs/${job.id}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.job?.id) {
        window.location.href = `/app/jobs/${data.job.id}`;
        return;
      }
      setRetryError(data.error || copy.job.retry);
    } catch {
      setRetryError(locale === "tr" ? "Sunucuya ulaşılamadı." : "Could not reach the server.");
    }
    setRetrying(false);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="meta-row" style={{ marginBottom: 8 }}>
            <StatusBadge locale={locale} status={job.status} />
          </div>
          <h1 style={{ fontSize: 36 }}>
            {job.type ? (getModules(locale).find(m => m.id === job.type)?.title || job.title) : job.title}
          </h1>
          <p className="muted">{copy.job.id}: {job.id}</p>
        </div>
        <button className="button secondary" disabled={retrying} onClick={retry} type="button">
          <RotateCcw size={16} />
          {retrying ? copy.job.retrying : copy.job.retry}
        </button>
      </div>

      <div className="stats-grid">
        {summaryItems.map(([label, value]) => (
          <div className="stat" key={label as string}>
            <span>{label as string}</span>
            <strong style={{ fontSize: 16 }}>{value as string}</strong>
          </div>
        ))}
      </div>

      {currentStage && !isTerminal ? (
        <div className="stage-strip">
          <span>{locale === "tr" ? "Mevcut aşama" : "Current stage"}</span>
          <strong>{currentStage.label}</strong>
          <code>{currentStage.key}</code>
        </div>
      ) : null}

      {job.errorMessage ? <p className="notice">{job.errorMessage}</p> : null}
      {retryError ? <p className="notice" role="alert">{retryError}</p> : null}

      {credentials ? <CredentialsCard credentials={credentials} copy={copy} /> : null}

      <section className="panel">
        <h2>{copy.job.liveLog}</h2>
        <div className="log-shell" ref={logShellRef} aria-live="polite">
          {logs.length === 0 ? (
            <div className="log-line">
              <span className="time">--:--:--</span>
              <span className="message">{copy.job.waitingLog}</span>
            </div>
          ) : logs.map(log => (
            <div className={`log-line ${log.level}`} key={log.id}>
              <span className="time">{new Date(log.created_at).toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US")}</span>
              <span className="message">{log.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type JobCredentials = {
  studioUrl?: string;
  apiUrl?: string;
  user?: string;
  password?: string;
};

// Erişim bilgilerini, motorun bastığı son özet satırlarından ayıkla.
// (Yeni persistensiyon yok; loglarda zaten var olan değerleri derli toplu gösteriyoruz.)
function extractCredentials(logs: JobEventRow[]): JobCredentials | null {
  const creds: JobCredentials = {};
  for (const log of logs) {
    const msg = log.message;
    const studio = msg.match(/Studio:\s*(https?:\/\/\S+)/i);
    if (studio) creds.studioUrl = studio[1];
    const api = msg.match(/API:\s*(https?:\/\/\S+)/i);
    if (api) creds.apiUrl = api[1];
    const dash = msg.match(/Dashboard Kullanıcı:\s*(\S+)\s*\/\s*(\S+)/i);
    if (dash) { creds.user = dash[1]; creds.password = dash[2]; }
  }
  return (creds.studioUrl || creds.password) ? creds : null;
}

function CopyButton({ value, copyLabel, copiedLabel }: { value: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button ghost"
      style={{ padding: "4px 10px", fontSize: 13 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // pano erişimi reddedildiyse sessiz geç
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}

function CredentialsCard({ credentials, copy }: { credentials: JobCredentials; copy: ReturnType<typeof getCopy> }) {
  const c = copy.job.credentials;
  const rows: Array<{ label: string; value: string; href?: string; mono?: boolean }> = [];
  if (credentials.studioUrl) rows.push({ label: c.studio, value: credentials.studioUrl, href: credentials.studioUrl });
  if (credentials.apiUrl) rows.push({ label: c.api, value: credentials.apiUrl, href: credentials.apiUrl });
  if (credentials.user) rows.push({ label: c.user, value: credentials.user, mono: true });
  if (credentials.password) rows.push({ label: c.password, value: credentials.password, mono: true });

  return (
    <section className="panel" style={{ marginBottom: 18, borderLeft: "3px solid var(--color-primary, #1f7a4d)" }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 0 }}>
        <KeyRound size={18} /> {c.title}
      </h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 16, fontSize: 13 }}>{c.hint}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(row => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span className="muted" style={{ minWidth: 110, fontSize: 13 }}>{row.label}</span>
            <code style={{ flex: 1, wordBreak: "break-all", fontFamily: row.mono ? "monospace" : undefined, fontSize: 14 }}>{row.value}</code>
            <div style={{ display: "flex", gap: 6 }}>
              {row.href ? (
                <a className="button ghost" style={{ padding: "4px 10px", fontSize: 13 }} href={row.href} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> {c.open}
                </a>
              ) : null}
              <CopyButton value={row.value} copyLabel={c.copy} copiedLabel={c.copied} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function getCurrentStage(logs: JobEventRow[]) {
  for (const log of [...logs].reverse()) {
    const stageMatch = log.message.match(/^Aşama:\s*([a-z_]+)\s+—\s+(.+)$/);
    if (stageMatch) {
      return {
        key: stageMatch[1],
        label: stageMatch[2]
      };
    }

    const stoppedMatch = log.message.match(/^İşlem şu aşamada durdu:\s*([a-z_]+)\s+—\s+(.+)$/);
    if (stoppedMatch) {
      return {
        key: stoppedMatch[1],
        label: stoppedMatch[2]
      };
    }
  }
  return null;
}

function formatFlags(flags: string[] | undefined, locale: Locale) {
  if (!flags?.length) return "-";

  const labels: Record<Locale, Record<string, string>> = {
    tr: {
      "Backup transfer": "Yedek aktarımı",
      "Storage transfer": "Storage aktarımı",
      "Minor errors allowed": "Küçük hatalarda devam",
      "Skip install": "Kurulum atlandı",
      "Dry run": "Demo çalışma"
    },
    en: {
      "Backup transfer": "Backup transfer",
      "Storage transfer": "Storage transfer",
      "Minor errors allowed": "Minor errors allowed",
      "Skip install": "Skip install",
      "Dry run": "Dry run"
    }
  };

  return flags.map(flag => labels[locale][flag] || flag).join(", ");
}
