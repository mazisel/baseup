"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  Globe,
  PauseCircle,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Siren,
  Trash2,
} from "lucide-react";
import { getCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";
import type { HealthEvent, HealthMonitor } from "@/types/domain";

type MonitorStatus = HealthMonitor["status"];
type MonitorFilter = "all" | MonitorStatus;

type MonitorInsight = {
  monitor: HealthMonitor;
  events: HealthEvent[];
  uptime: number | null;
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  latestResponseMs: number | null;
  incidentCount: number;
  stableChecks: number;
  timeline: HealthEvent[];
  timelineMaxMs: number;
  lastSignalAt?: string;
};

const FILTER_ORDER: MonitorFilter[] = ["all", "up", "down", "pending", "paused"];

export function MonitorsClient({ locale }: { locale: Locale }) {
  const copy = getCopy(locale).monitors;
  const [monitors, setMonitors] = useState<HealthMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("all");

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const fetchMonitors = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/monitors");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMonitors(data.monitors || []);
      } else {
        setError(data.error || copy.loadError);
      }
    } catch {
      setError(copy.networkError);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [copy.loadError, copy.networkError]);

  useEffect(() => {
    fetchMonitors();
    const timer = setInterval(() => fetchMonitors({ silent: true }), 30_000);
    return () => clearInterval(timer);
  }, [fetchMonitors]);

  async function refreshNow() {
    setRefreshing(true);
    await fetchMonitors({ silent: true });
    setRefreshing(false);
  }

  async function addMonitor(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError("");

    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, url: newUrl })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewName("");
        setNewUrl("");
        await fetchMonitors({ silent: true });
      } else {
        setError(data.error || copy.addError);
      }
    } catch {
      setError(copy.networkError);
    } finally {
      setAdding(false);
    }
  }

  async function deleteMonitor(id: string) {
    if (!confirm(copy.deleteConfirm)) return;

    try {
      const res = await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchMonitors({ silent: true });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || copy.deleteError);
      }
    } catch {
      setError(copy.networkError);
    }
  }

  const insights = useMemo(() => monitors.map(buildMonitorInsight), [monitors]);
  const summary = useMemo(() => buildFleetSummary(insights), [insights]);

  const filters = useMemo(() => {
    return FILTER_ORDER.map(key => ({
      key,
      label: key === "all" ? copy.filterAll : copy.statuses[key],
      count: key === "all" ? monitors.length : monitors.filter(monitor => monitor.status === key).length,
    }));
  }, [copy.filterAll, copy.statuses, monitors]);

  const visibleInsights = filter === "all"
    ? insights
    : insights.filter(insight => insight.monitor.status === filter);

  const fleetStatusLabel = summary.down > 0
    ? copy.fleetStatusDegraded
    : summary.active === 0 || (summary.up === 0 && summary.pending > 0)
      ? copy.fleetStatusWaiting
      : copy.fleetStatusOk;

  return (
    <div className="content monitors-workspace">
      <div className="page-head monitor-page-head">
        <div>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.description}</p>
        </div>
        <div className="monitor-head-actions">
          <span className="tag monitor-refresh-tag">
            <Activity size={14} />
            {copy.autoRefresh}
          </span>
          <button className="button secondary" disabled={loading || refreshing} onClick={refreshNow} type="button">
            <RefreshCw className={refreshing ? "monitor-spin" : ""} size={16} />
            {refreshing ? copy.refreshing : copy.refresh}
          </button>
        </div>
      </div>

      {monitors.length > 0 && (
        <section className="monitor-overview" aria-label={copy.fleetStatus}>
          <div className={`monitor-overview-primary ${summary.down > 0 ? "down" : "up"}`}>
            <small>{copy.fleetStatus}</small>
            <strong>{fleetStatusLabel}</strong>
            <span>{summary.up}/{summary.active || summary.total} {copy.monitorsUp}</span>
          </div>
          <MetricTile icon={<ShieldCheck size={18} />} label={copy.fleetUptime} value={formatPercent(summary.uptime)} />
          <MetricTile icon={<Gauge size={18} />} label={copy.averageLatency} value={formatMs(summary.avgResponseMs)} />
          <MetricTile icon={<Siren size={18} />} label={copy.incidents} value={formatNumber(summary.incidents, locale)} />
          <MetricTile
            icon={<Clock3 size={18} />}
            label={copy.lastSignal}
            value={formatRelativeTime(summary.lastSignalAt, locale, copy.waiting)}
          />
        </section>
      )}

      <section className="panel monitor-add-panel">
        <div className="monitor-form-head">
          <div>
            <h2>{copy.addTitle}</h2>
          </div>
          <span className="tag">
            <Radio size={14} />
            HTTP(S)
          </span>
        </div>
        <form className="monitor-add-form" onSubmit={addMonitor}>
          <div className="field">
            <label htmlFor="name">{copy.nameLabel}</label>
            <input
              id="name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={copy.namePlaceholder}
              required
            />
          </div>
          <div className="field monitor-url-field">
            <label htmlFor="url">{copy.urlLabel}</label>
            <input
              id="url"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder={copy.urlPlaceholder}
              required
            />
          </div>
          <button className="button primary" disabled={adding} type="submit">
            <Plus size={16} />
            {adding ? copy.adding : copy.add}
          </button>
        </form>
        {error && <p className="notice" role="alert">{error}</p>}
      </section>

      {loading ? (
        <div className="monitor-loading-grid" aria-live="polite">
          <div className="panel monitor-loading-card" />
          <div className="panel monitor-loading-card" />
          <div className="panel monitor-loading-card" />
        </div>
      ) : monitors.length === 0 ? (
        <div className="panel monitor-empty">
          <Globe size={48} />
          <h3>{copy.emptyTitle}</h3>
          <p className="muted">{copy.emptyDescription}</p>
        </div>
      ) : (
        <>
          <div className="monitor-toolbar">
            <div className="segmented monitor-filter" aria-label={copy.filtersLabel}>
              {filters.map(item => (
                <button
                  key={item.key}
                  className={filter === item.key ? "active" : ""}
                  onClick={() => setFilter(item.key)}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
            </div>
            <span className="muted">{visibleInsights.length}/{monitors.length}</span>
          </div>

          {visibleInsights.length === 0 ? (
            <div className="panel monitor-empty">
              <Activity size={42} />
              <h3>{copy.noFilteredTitle}</h3>
              <p className="muted">{copy.noFilteredDescription}</p>
            </div>
          ) : (
            <div className="monitor-grid">
              {visibleInsights.map(insight => (
                <MonitorCard
                  copy={copy}
                  insight={insight}
                  key={insight.monitor.id}
                  locale={locale}
                  onDelete={deleteMonitor}
                />
              ))}
            </div>
          )}
        </>
      )}

      <style>{`
        .monitors-workspace {
          display: grid;
          gap: 20px;
        }

        .monitor-page-head {
          margin-bottom: 0;
        }

        .monitor-page-head h1 {
          font-size: 36px;
          line-height: 1.05;
          margin-bottom: 8px;
        }

        .monitor-head-actions {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: flex-end;
        }

        .monitor-refresh-tag svg,
        .tag svg {
          flex-shrink: 0;
        }

        .monitor-spin {
          animation: monitorSpin 700ms linear infinite;
        }

        .monitor-overview {
          display: grid;
          gap: 12px;
          grid-template-columns: minmax(220px, 1.3fr) repeat(4, minmax(150px, 1fr));
        }

        .monitor-overview-primary,
        .monitor-overview-tile {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 8px;
          min-width: 0;
          padding: 16px;
        }

        .monitor-overview-primary {
          display: grid;
          gap: 6px;
        }

        .monitor-overview-primary.up {
          border-color: color-mix(in srgb, var(--green) 34%, var(--line));
        }

        .monitor-overview-primary.down {
          border-color: color-mix(in srgb, var(--red) 42%, var(--line));
        }

        .monitor-overview-primary small,
        .monitor-overview-tile small,
        .monitor-metric small,
        .monitor-section-title {
          color: var(--muted);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .monitor-overview-primary strong {
          font-size: 26px;
          line-height: 1.05;
        }

        .monitor-overview-primary span {
          color: var(--muted);
          font-size: 13px;
          font-weight: 700;
        }

        .monitor-overview-tile {
          display: grid;
          gap: 7px;
        }

        .monitor-overview-tile svg {
          color: var(--green);
        }

        .monitor-overview-tile strong {
          display: block;
          font-size: 22px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .monitor-add-panel {
          display: grid;
          gap: 16px;
        }

        .monitor-form-head {
          align-items: center;
          display: flex;
          gap: 12px;
          justify-content: space-between;
        }

        .monitor-form-head h2 {
          font-size: 22px;
          margin-bottom: 0;
        }

        .monitor-add-form {
          align-items: end;
          display: grid;
          gap: 14px;
          grid-template-columns: minmax(180px, 0.85fr) minmax(280px, 1.4fr) auto;
        }

        .monitor-url-field input {
          font-family: "SFMono-Regular", Consolas, monospace;
          font-size: 13px;
        }

        .monitor-toolbar {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: space-between;
        }

        .monitor-filter {
          flex-wrap: wrap;
        }

        .monitor-filter button {
          gap: 7px;
          min-width: auto;
        }

        .monitor-filter strong {
          background: var(--surface-muted);
          border-radius: 999px;
          color: var(--muted);
          display: inline-flex;
          font-size: 11px;
          justify-content: center;
          min-width: 22px;
          padding: 3px 6px;
        }

        .monitor-filter button.active strong {
          background: var(--surface);
          color: var(--ink);
        }

        .monitor-grid,
        .monitor-loading-grid {
          display: grid;
          gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
        }

        .monitor-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 8px;
          display: grid;
          gap: 16px;
          min-width: 0;
          padding: 16px;
        }

        .monitor-card.up {
          border-top-color: var(--green);
        }

        .monitor-card.down {
          border-top-color: var(--red);
        }

        .monitor-card.pending,
        .monitor-card.paused {
          border-top-color: var(--amber);
        }

        .monitor-card-head {
          align-items: flex-start;
          display: flex;
          gap: 12px;
          justify-content: space-between;
          min-width: 0;
        }

        .monitor-title-block {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .monitor-title-row {
          align-items: center;
          display: flex;
          gap: 8px;
          min-width: 0;
        }

        .monitor-title-row h3 {
          font-size: 18px;
          line-height: 1.2;
          margin: 0;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .monitor-url {
          color: var(--muted);
          font-family: "SFMono-Regular", Consolas, monospace;
          font-size: 12px;
          line-height: 1.5;
          margin: 0;
          overflow-wrap: anywhere;
        }

        .monitor-card-actions {
          align-items: center;
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .monitor-icon-button,
        .monitor-link-button {
          align-items: center;
          border-radius: 8px;
          display: inline-flex;
          height: 34px;
          justify-content: center;
          min-height: 34px;
          padding: 0;
          width: 34px;
        }

        .monitor-link-button {
          border: 1px solid transparent;
          color: var(--muted);
        }

        .monitor-link-button:hover,
        .monitor-icon-button:hover {
          background: var(--surface-muted);
          color: var(--ink);
        }

        .monitor-icon-button.danger {
          color: var(--red);
        }

        .monitor-status-pill {
          align-items: center;
          border-radius: 999px;
          display: inline-flex;
          font-size: 12px;
          font-weight: 800;
          gap: 6px;
          min-height: 28px;
          padding: 0 10px;
          width: fit-content;
        }

        .monitor-status-pill.up {
          background: var(--green-soft);
          color: var(--green);
        }

        .monitor-status-pill.down {
          background: var(--red-soft);
          color: var(--red);
        }

        .monitor-status-pill.pending,
        .monitor-status-pill.paused {
          background: var(--amber-soft);
          color: var(--amber);
        }

        .monitor-timeline-wrap {
          display: grid;
          gap: 8px;
        }

        .monitor-timeline {
          align-items: end;
          background: var(--surface-strong);
          border: 1px solid var(--line);
          border-radius: 8px;
          display: grid;
          gap: 3px;
          grid-template-columns: repeat(24, minmax(4px, 1fr));
          height: 58px;
          padding: 8px;
        }

        .monitor-bar {
          align-self: end;
          border-radius: 999px 999px 3px 3px;
          min-height: 10px;
        }

        .monitor-bar.up {
          background: var(--green);
        }

        .monitor-bar.down {
          background: var(--red);
        }

        .monitor-bar.empty {
          background: var(--surface-muted);
          opacity: 0.72;
        }

        .monitor-metric-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .monitor-metric {
          background: var(--surface-strong);
          border: 1px solid var(--line);
          border-radius: 8px;
          min-width: 0;
          padding: 10px;
        }

        .monitor-metric strong {
          display: block;
          font-size: 17px;
          margin-top: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .monitor-metric span {
          color: var(--muted);
          display: block;
          font-size: 11px;
          margin-top: 3px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .monitor-signal-row {
          align-items: center;
          display: grid;
          gap: 8px;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .monitor-signal-item {
          align-items: center;
          color: var(--muted);
          display: flex;
          font-size: 12px;
          gap: 7px;
          min-width: 0;
        }

        .monitor-signal-item span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .monitor-signal-item svg {
          color: var(--green);
          flex-shrink: 0;
        }

        .monitor-signal-item.error svg,
        .monitor-signal-item.error {
          color: var(--red);
        }

        .monitor-section-title {
          align-items: center;
          display: flex;
          justify-content: space-between;
        }

        .monitor-event-list {
          border-top: 1px solid var(--line);
          display: grid;
          gap: 0;
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .monitor-event {
          align-items: flex-start;
          border-bottom: 1px solid var(--line);
          display: grid;
          gap: 10px;
          grid-template-columns: 24px minmax(0, 1fr);
          padding: 10px 0;
        }

        .monitor-event:last-child {
          border-bottom: 0;
          padding-bottom: 0;
        }

        .monitor-event-icon {
          align-items: center;
          border-radius: 999px;
          display: inline-flex;
          height: 24px;
          justify-content: center;
          width: 24px;
        }

        .monitor-event.up .monitor-event-icon {
          background: var(--green-soft);
          color: var(--green);
        }

        .monitor-event.down .monitor-event-icon {
          background: var(--red-soft);
          color: var(--red);
        }

        .monitor-event-body {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .monitor-event-body strong {
          font-size: 13px;
          line-height: 1.2;
        }

        .monitor-event-body span,
        .monitor-event-body em {
          color: var(--muted);
          font-size: 12px;
          font-style: normal;
          overflow-wrap: anywhere;
        }

        .monitor-empty {
          color: var(--muted);
          display: grid;
          justify-items: center;
          padding: 42px 20px;
          text-align: center;
        }

        .monitor-empty h3 {
          color: var(--ink);
          margin-bottom: 6px;
        }

        .monitor-loading-card {
          height: 330px;
          overflow: hidden;
          position: relative;
        }

        .monitor-loading-card::after {
          animation: monitorPulse 1.2s ease-in-out infinite;
          background: linear-gradient(90deg, transparent, var(--surface-muted), transparent);
          content: "";
          inset: 0;
          position: absolute;
          transform: translateX(-100%);
        }

        @keyframes monitorPulse {
          100% {
            transform: translateX(100%);
          }
        }

        @keyframes monitorSpin {
          100% {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .monitor-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .monitor-page-head,
          .monitor-form-head,
          .monitor-toolbar {
            align-items: stretch;
            display: grid;
          }

          .monitor-head-actions {
            justify-content: stretch;
          }

          .monitor-head-actions .button,
          .monitor-head-actions .tag {
            width: 100%;
          }

          .monitor-overview,
          .monitor-add-form,
          .monitor-grid,
          .monitor-loading-grid,
          .monitor-metric-grid,
          .monitor-signal-row {
            grid-template-columns: 1fr;
          }

          .monitor-card-head {
            align-items: stretch;
            display: grid;
          }

          .monitor-card-actions {
            justify-content: space-between;
          }

          .monitor-filter {
            align-items: stretch;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            width: 100%;
          }

          .monitor-filter button {
            min-width: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function MonitorCard({
  copy,
  insight,
  locale,
  onDelete,
}: {
  copy: ReturnType<typeof getCopy>["monitors"];
  insight: MonitorInsight;
  locale: Locale;
  onDelete: (id: string) => void;
}) {
  const { monitor } = insight;
  const latestEvent = insight.events[0];
  const latestError = latestEvent?.errorMessage;
  const emptySlots = Math.max(0, 24 - insight.timeline.length);

  return (
    <article className={`monitor-card ${monitor.status}`}>
      <div className="monitor-card-head">
        <div className="monitor-title-block">
          <span className={`monitor-status-pill ${monitor.status}`}>
            {getStatusIcon(monitor.status, 14)}
            {copy.statuses[monitor.status]}
          </span>
          <div className="monitor-title-row">
            <h3 title={monitor.name}>{monitor.name}</h3>
          </div>
          <p className="monitor-url">{monitor.url}</p>
        </div>
        <div className="monitor-card-actions">
          <a
            aria-label={copy.openUrl}
            className="monitor-link-button"
            href={monitor.url}
            rel="noreferrer"
            target="_blank"
            title={copy.openUrl}
          >
            <ExternalLink size={16} />
          </a>
          <button
            aria-label={copy.deleteMonitor}
            className="button ghost monitor-icon-button danger"
            onClick={() => onDelete(monitor.id)}
            title={copy.deleteMonitor}
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="monitor-timeline-wrap">
        <div className="monitor-section-title">
          <span>{copy.recentChecks}</span>
          <span>{insight.events.length} {copy.checks}</span>
        </div>
        <div className="monitor-timeline" aria-label={copy.recentChecks}>
          {Array.from({ length: emptySlots }).map((_, index) => (
            <span
              className="monitor-bar empty"
              key={`empty-${index}`}
              style={{ height: 12 }}
              title={copy.timelinePending}
            />
          ))}
          {insight.timeline.map(event => (
            <span
              className={`monitor-bar ${event.status}`}
              key={event.id}
              style={{ height: getTimelineHeight(event, insight.timelineMaxMs) }}
              title={`${event.status === "up" ? copy.timelineUp : copy.timelineDown} - ${formatDateTime(event.createdAt, locale)} - ${formatMs(event.responseTimeMs)}`}
            />
          ))}
        </div>
      </div>

      <div className="monitor-metric-grid">
        <div className="monitor-metric">
          <small>{copy.uptime}</small>
          <strong>{formatPercent(insight.uptime)}</strong>
          <span>{insight.events.length} {copy.samples}</span>
        </div>
        <div className="monitor-metric">
          <small>{copy.avgResponse}</small>
          <strong>{formatMs(insight.avgResponseMs)}</strong>
          <span>{copy.responseTime}</span>
        </div>
        <div className="monitor-metric">
          <small>{copy.p95Response}</small>
          <strong>{formatMs(insight.p95ResponseMs)}</strong>
          <span>{copy.responseTime}</span>
        </div>
        <div className="monitor-metric">
          <small>{copy.incidents}</small>
          <strong>{formatNumber(insight.incidentCount, locale)}</strong>
          <span>{insight.stableChecks ? `${insight.stableChecks} ${copy.stableFor}` : copy.waiting}</span>
        </div>
      </div>

      <div className="monitor-signal-row">
        <div className="monitor-signal-item">
          <Clock3 size={15} />
          <span title={formatDateTime(insight.lastSignalAt, locale)}>
            {copy.lastCheck}: {formatRelativeTime(insight.lastSignalAt, locale, copy.waiting)}
          </span>
        </div>
        <div className="monitor-signal-item">
          <Gauge size={15} />
          <span>{copy.responseTime}: {formatMs(insight.latestResponseMs)}</span>
        </div>
        <div className={`monitor-signal-item ${latestError ? "error" : ""}`}>
          {latestError ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{latestError ? `${copy.errorLabel}: ${latestError}` : copy.timelineUp}</span>
        </div>
      </div>

      <div>
        <div className="monitor-section-title">
          <span>{copy.latestEvents}</span>
          <span>{copy.created}: {formatRelativeTime(monitor.createdAt, locale, copy.waiting)}</span>
        </div>
        {insight.events.length === 0 ? (
          <p className="muted" style={{ margin: "10px 0 0" }}>{copy.noEvents}</p>
        ) : (
          <ul className="monitor-event-list">
            {insight.events.slice(0, 4).map(event => (
              <li className={`monitor-event ${event.status}`} key={event.id}>
                <span className="monitor-event-icon">
                  {event.status === "up" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                </span>
                <span className="monitor-event-body">
                  <strong>{event.status === "up" ? copy.statuses.up : copy.statuses.down}</strong>
                  <span>{formatRelativeTime(event.createdAt, locale, copy.waiting)} - {formatMs(event.responseTimeMs)}</span>
                  {event.errorMessage && <em>{event.errorMessage}</em>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="monitor-overview-tile">
      {icon}
      <small>{label}</small>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function buildMonitorInsight(monitor: HealthMonitor): MonitorInsight {
  const events = [...(monitor.events || [])].sort((a, b) => (
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ));
  const ascendingEvents = [...events].reverse();
  const responseTimes = events
    .map(event => event.responseTimeMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const upEvents = events.filter(event => event.status === "up").length;
  const uptime = events.length > 0 ? (upEvents / events.length) * 100 : statusFallbackUptime(monitor.status);
  const latestStatus = events[0]?.status;
  const stableChecks = latestStatus ? countStableChecks(events, latestStatus) : 0;

  return {
    monitor,
    events,
    uptime,
    avgResponseMs: average(responseTimes),
    p95ResponseMs: percentile(responseTimes, 95),
    latestResponseMs: events[0]?.responseTimeMs ?? null,
    incidentCount: countIncidents(ascendingEvents),
    stableChecks,
    timeline: events.slice(0, 24).reverse(),
    timelineMaxMs: Math.max(...responseTimes, 1),
    lastSignalAt: monitor.lastCheckedAt || events[0]?.createdAt,
  };
}

function buildFleetSummary(insights: MonitorInsight[]) {
  const total = insights.length;
  const active = insights.filter(insight => insight.monitor.status !== "paused").length;
  const up = insights.filter(insight => insight.monitor.status === "up").length;
  const down = insights.filter(insight => insight.monitor.status === "down").length;
  const pending = insights.filter(insight => insight.monitor.status === "pending").length;
  const responseTimes = insights.flatMap(insight => (
    insight.events
      .map(event => event.responseTimeMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  ));
  const eventCount = insights.reduce((sum, insight) => sum + insight.events.length, 0);
  const upEvents = insights.reduce((sum, insight) => sum + insight.events.filter(event => event.status === "up").length, 0);
  const uptime = eventCount > 0 ? (upEvents / eventCount) * 100 : active > 0 ? (up / active) * 100 : null;
  const lastSignalAt = insights
    .map(insight => insight.lastSignalAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

  return {
    total,
    active,
    up,
    down,
    pending,
    uptime,
    avgResponseMs: average(responseTimes),
    incidents: insights.reduce((sum, insight) => sum + insight.incidentCount, 0),
    lastSignalAt,
  };
}

function getStatusIcon(status: MonitorStatus, size = 16) {
  if (status === "up") return <CheckCircle2 size={size} />;
  if (status === "down") return <AlertCircle size={size} />;
  if (status === "paused") return <PauseCircle size={size} />;
  return <Activity size={size} />;
}

function statusFallbackUptime(status: MonitorStatus) {
  if (status === "up") return 100;
  if (status === "down") return 0;
  return null;
}

function countIncidents(events: HealthEvent[]) {
  let incidents = 0;
  let previousStatus: HealthEvent["status"] | undefined;
  for (const event of events) {
    if (event.status === "down" && previousStatus !== "down") incidents += 1;
    previousStatus = event.status;
  }
  return incidents;
}

function countStableChecks(events: HealthEvent[], status: HealthEvent["status"]) {
  let count = 0;
  for (const event of events) {
    if (event.status !== status) break;
    count += 1;
  }
  return count;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], target: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((target / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function getTimelineHeight(event: HealthEvent, maxMs: number) {
  if (event.status === "down") return 42;
  if (typeof event.responseTimeMs !== "number") return 18;
  const ratio = Math.min(event.responseTimeMs / Math.max(maxMs, 1), 1);
  return Math.round(18 + ratio * 28);
}

function formatPercent(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(value >= 99.95 || value < 10 ? 2 : 1)}%`;
}

function formatMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value)} ms`;
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(getLocaleTag(locale)).format(value);
}

function formatRelativeTime(value: string | undefined, locale: Locale, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1_000],
  ];
  const fallbackUnit: [Intl.RelativeTimeFormatUnit, number] = ["second", 1_000];
  const [unit, unitMs] = units.find(([, ms]) => absMs >= ms) ?? fallbackUnit;
  return new Intl.RelativeTimeFormat(getLocaleTag(locale), { numeric: "auto" }).format(Math.round(diffMs / unitMs), unit);
}

function formatDateTime(value: string | undefined, locale: Locale) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getLocaleTag(locale: Locale) {
  return locale === "tr" ? "tr-TR" : "en-US";
}
