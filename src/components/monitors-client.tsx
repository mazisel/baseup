"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, Plus, Trash2, Globe, AlertCircle, CheckCircle2, PauseCircle } from "lucide-react";
import { getCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";
import type { HealthMonitor } from "@/types/domain";

export function MonitorsClient({ locale }: { locale: Locale }) {
  const copy = getCopy(locale).monitors;
  const [monitors, setMonitors] = useState<HealthMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const fetchMonitors = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [copy.loadError, copy.networkError]);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  async function addMonitor(e: React.FormEvent) {
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
        await fetchMonitors();
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
        await fetchMonitors();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || copy.deleteError);
      }
    } catch {
      setError(copy.networkError);
    }
  }

  function getStatusIcon(status: string) {
    if (status === "up") return <CheckCircle2 size={16} color="var(--green)" />;
    if (status === "down") return <AlertCircle size={16} color="var(--red)" />;
    if (status === "paused") return <PauseCircle size={16} color="var(--muted)" />;
    return <Activity size={16} color="var(--muted)" />;
  }

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.title}</h1>
          <p className="muted">{copy.description}</p>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 32 }}>
        <h2>{copy.addTitle}</h2>
        <form onSubmit={addMonitor} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 16 }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="name">{copy.nameLabel}</label>
            <input id="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder={copy.namePlaceholder} required />
          </div>
          <div className="field" style={{ flex: 2, margin: 0 }}>
            <label htmlFor="url">{copy.urlLabel}</label>
            <input id="url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder={copy.urlPlaceholder} required />
          </div>
          <button className="button primary" disabled={adding} type="submit" style={{ height: 42 }}>
            <Plus size={16} />
            {adding ? copy.adding : copy.add}
          </button>
        </form>
        {error && <p className="notice" role="alert" style={{ marginTop: 16 }}>{error}</p>}
      </section>

      {loading ? (
        <p className="muted">{copy.loading}</p>
      ) : monitors.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Globe size={48} color="var(--muted)" style={{ marginBottom: 16 }} />
          <h3>{copy.emptyTitle}</h3>
          <p className="muted">{copy.emptyDescription}</p>
        </div>
      ) : (
        <div className="grid">
          {monitors.map(m => (
            <div key={m.id} className="panel" style={{ position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {getStatusIcon(m.status)}
                  {m.name}
                </h3>
                <button onClick={() => deleteMonitor(m.id)} className="button ghost" style={{ padding: 4, color: "var(--red)" }}>
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="muted" style={{ fontSize: 13, wordBreak: 'break-all' }}>{m.url}</p>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span className="muted">{copy.statusLabel}: <strong style={{ textTransform: 'capitalize' }}>{m.status}</strong></span>
                <span className="muted">{copy.lastCheck}: {m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-US") : copy.waiting}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
      `}</style>
    </div>
  );
}
