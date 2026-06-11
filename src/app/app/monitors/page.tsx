"use client";

import { useState, useEffect } from "react";
import { Activity, Plus, Trash2, Globe, AlertCircle, CheckCircle2, PauseCircle } from "lucide-react";
import type { HealthMonitor } from "@/types/domain";

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<HealthMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  async function fetchMonitors() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/monitors");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMonitors(data.monitors || []);
      } else {
        setError(data.error || "Monitörler yüklenemedi.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMonitors();
  }, []);

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
        setError(data.error || "Monitör eklenemedi.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.");
    } finally {
      setAdding(false);
    }
  }

  async function deleteMonitor(id: string) {
    if (!confirm("Emin misiniz? Bu monitör silinecektir.")) return;

    try {
      const res = await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchMonitors();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Monitör silinemedi.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.");
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
          <h1 style={{ fontSize: 38 }}>Uptime Monitors</h1>
          <p className="muted">Sunucularınızın ve API uç noktalarınızın durumunu 7/24 izleyin.</p>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 32 }}>
        <h2>Yeni Monitör Ekle</h2>
        <form onSubmit={addMonitor} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 16 }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="name">Monitör Adı</label>
            <input id="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Production DB" required />
          </div>
          <div className="field" style={{ flex: 2, margin: 0 }}>
            <label htmlFor="url">URL veya IP</label>
            <input id="url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://api.myproject.com/health" required />
          </div>
          <button className="button primary" disabled={adding} type="submit" style={{ height: 42 }}>
            <Plus size={16} />
            {adding ? "Ekleniyor..." : "Ekle"}
          </button>
        </form>
        {error && <p className="notice" role="alert" style={{ marginTop: 16 }}>{error}</p>}
      </section>

      {loading ? (
        <p className="muted">Yükleniyor...</p>
      ) : monitors.length === 0 ? (
        <div className="panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <Globe size={48} color="var(--muted)" style={{ marginBottom: 16 }} />
          <h3>Henüz Monitör Yok</h3>
          <p className="muted">İzlemek istediğiniz sunucu veya API uç noktasını yukarıdan ekleyin.</p>
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
                <span className="muted">Durum: <strong style={{ textTransform: 'capitalize' }}>{m.status}</strong></span>
                <span className="muted">Son kontrol: {m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString() : 'Bekleniyor'}</span>
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
