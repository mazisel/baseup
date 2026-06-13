"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Server, Trash2 } from "lucide-react";
import { getCopy } from "@/lib/i18n";
import type { Locale } from "@/lib/preference-shared";
import type { SavedServer } from "@/types/domain";

type Drafts = Record<string, { name: string; host: string }>;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function readResponseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return data.error || fallback;
}

export function SavedServersManager({ locale }: { locale: Locale }) {
  const copy = getCopy(locale).savedServers;
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [newName, setNewName] = useState("");
  const [newHost, setNewHost] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadServers() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/saved-servers");
        if (!response.ok) {
          throw new Error(await readResponseError(response, copy.loadError));
        }

        const data = await response.json().catch(() => ({})) as { servers?: SavedServer[] };
        if (ignore) return;
        const nextServers = Array.isArray(data.servers) ? data.servers : [];
        setServers(nextServers);
        setDrafts(buildDrafts(nextServers));
      } catch (err: unknown) {
        if (!ignore) setError(getErrorMessage(err, copy.loadError));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadServers();
    return () => {
      ignore = true;
    };
  }, [copy.loadError]);

  function updateDraft(serverId: string, key: "name" | "host", value: string) {
    setDrafts(current => ({
      ...current,
      [serverId]: {
        name: current[serverId]?.name || "",
        host: current[serverId]?.host || "",
        [key]: value,
      },
    }));
  }

  async function addServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");

    try {
      const response = await fetch("/api/saved-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, host: newHost }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response, copy.addError));
      }

      const data = await response.json().catch(() => ({})) as { server?: SavedServer };
      if (!data.server) throw new Error(copy.addError);
      const createdServer = data.server;
      setServers(current => mergeServers(current, createdServer));
      setDrafts(current => ({ ...current, [createdServer.id]: { name: createdServer.name, host: createdServer.host } }));
      setNewName("");
      setNewHost("");
    } catch (err: unknown) {
      setError(getErrorMessage(err, copy.addError));
    } finally {
      setCreating(false);
    }
  }

  async function saveServer(serverId: string) {
    const draft = drafts[serverId];
    if (!draft) return;

    setSavingId(serverId);
    setError("");

    try {
      const response = await fetch(`/api/saved-servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response, copy.updateError));
      }

      const data = await response.json().catch(() => ({})) as { server?: SavedServer };
      if (!data.server) throw new Error(copy.updateError);
      const updatedServer = data.server;
      setServers(current => current.map(server => server.id === serverId ? updatedServer : server));
      setDrafts(current => ({ ...current, [serverId]: { name: updatedServer.name, host: updatedServer.host } }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, copy.updateError));
    } finally {
      setSavingId("");
    }
  }

  async function deleteServer(serverId: string) {
    if (!confirm(copy.deleteConfirm)) return;

    setDeletingId(serverId);
    setError("");

    try {
      const response = await fetch(`/api/saved-servers/${serverId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await readResponseError(response, copy.deleteError));
      }

      setServers(current => current.filter(server => server.id !== serverId));
      setDrafts(current => {
        const next = { ...current };
        delete next[serverId];
        return next;
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, copy.deleteError));
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="saved-servers-manager">
      <section className="panel">
        <h2>{copy.addTitle}</h2>
        {error ? <p className="notice" role="alert">{error}</p> : null}
        <form className="saved-server-form" onSubmit={addServer}>
          <div className="field">
            <label htmlFor="saved-server-name">{copy.nameLabel}</label>
            <input
              id="saved-server-name"
              onChange={event => setNewName(event.target.value)}
              placeholder={copy.namePlaceholder}
              required
              value={newName}
            />
          </div>
          <div className="field">
            <label htmlFor="saved-server-host">{copy.hostLabel}</label>
            <input
              id="saved-server-host"
              onChange={event => setNewHost(event.target.value)}
              placeholder={copy.hostPlaceholder}
              required
              value={newHost}
            />
          </div>
          <button className="button primary" disabled={creating} type="submit">
            <Plus size={16} />
            {creating ? copy.adding : copy.add}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>{copy.savedTitle}</h2>
        {loading ? <p className="muted">{copy.loading}</p> : null}
        {!loading && servers.length === 0 ? (
          <div className="empty-state">
            <Server size={28} />
            <h3>{copy.emptyTitle}</h3>
            <p className="muted">{copy.emptyDescription}</p>
          </div>
        ) : null}
        {!loading && servers.length > 0 ? (
          <div className="saved-server-list">
            {servers.map(server => {
              const draft = drafts[server.id] || { name: server.name, host: server.host };
              return (
                <div className="saved-server-row" key={server.id}>
                  <div className="field">
                    <label htmlFor={`server-name-${server.id}`}>{copy.nameLabel}</label>
                    <input
                      id={`server-name-${server.id}`}
                      onChange={event => updateDraft(server.id, "name", event.target.value)}
                      value={draft.name}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`server-host-${server.id}`}>{copy.hostLabel}</label>
                    <input
                      id={`server-host-${server.id}`}
                      onChange={event => updateDraft(server.id, "host", event.target.value)}
                      value={draft.host}
                    />
                  </div>
                  <div className="saved-server-actions">
                    <button
                      className="button secondary"
                      disabled={savingId === server.id || deletingId === server.id}
                      onClick={() => saveServer(server.id)}
                      type="button"
                    >
                      <Save size={16} />
                      {savingId === server.id ? copy.saving : copy.save}
                    </button>
                    <button
                      aria-label={copy.delete}
                      className="button danger"
                      disabled={savingId === server.id || deletingId === server.id}
                      onClick={() => deleteServer(server.id)}
                      title={copy.delete}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function buildDrafts(servers: SavedServer[]) {
  return Object.fromEntries(servers.map(server => [server.id, { name: server.name, host: server.host }]));
}

function mergeServers(current: SavedServer[], server: SavedServer) {
  const byId = new Map(current.map(item => [item.id, item]));
  byId.set(server.id, server);
  return Array.from(byId.values()).sort((a, b) => {
    const dateA = new Date(a.lastUsedAt || a.createdAt).getTime();
    const dateB = new Date(b.lastUsedAt || b.createdAt).getTime();
    return dateB - dateA;
  });
}
