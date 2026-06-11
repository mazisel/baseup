"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
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
  // initialJob.logs might be empty now because the server getJob doesn't fetch logs yet, we need to handle that or fetch logs on mount
  const [logs, setLogs] = useState<JobEventRow[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const logShellRef = useRef<HTMLDivElement>(null);
  const copy = getCopy(locale);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Fetch initial logs
    supabase.from("job_events").select("*").eq("job_id", initialJob.id).order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setLogs(data);
      });

    // Subscribe to realtime updates for this job
    const channel = supabase.channel(`job_${initialJob.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "job_runs", filter: `id=eq.${initialJob.id}` }, (payload) => {
        const row = payload.new as JobRunRow;
        setJob(prev => ({
          ...prev,
          status: row.status,
          updatedAt: row.updated_at,
          startedAt: row.started_at ?? undefined,
          finishedAt: row.finished_at ?? undefined,
          errorMessage: row.error_message ?? undefined,
        }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_events", filter: `job_id=eq.${initialJob.id}` }, (payload) => {
        setLogs(current => [...current, payload.new as JobEventRow]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialJob.id, supabase]);

  useEffect(() => {
    const shell = logShellRef.current;
    if (!shell) return;
    shell.scrollTop = shell.scrollHeight;
  }, [logs]);

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

      {job.errorMessage ? <p className="notice">{job.errorMessage}</p> : null}
      {retryError ? <p className="notice" role="alert">{retryError}</p> : null}

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
