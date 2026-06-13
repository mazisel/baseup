"use client";

import { useState } from "react";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  monthlyJobLimit: number;
  parallelJobLimit: number;
  memberCount: number;
  jobCount: number;
  createdAt: string;
};

import type { Package } from "@/lib/admin";

export function WorkspaceTable({ workspaces: initial, packages }: { workspaces: Workspace[], packages: Package[] }) {
  const [workspaces, setWorkspaces] = useState(initial);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function changePlan(workspaceId: string, newPlan: string) {
    setLoading(workspaceId);
    setMessage("");

    const res = await fetch("/api/admin/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, plan: newPlan }),
    });

    if (res.ok) {
      setWorkspaces(prev =>
        prev.map(ws =>
          ws.id === workspaceId ? { ...ws, plan: newPlan } : ws
        )
      );
      setMessage(`✅ ${workspaceId.slice(0, 8)}... planı "${newPlan}" olarak güncellendi.`);
    } else {
      setMessage("❌ Plan güncellenirken hata oluştu.");
    }
    setLoading(null);
  }

  return (
    <>
      {message && (
        <div className="notice" style={{ marginBottom: 16 }}>{message}</div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "12px 16px" }}>Workspace</th>
              <th style={{ padding: "12px 16px" }}>Üye</th>
              <th style={{ padding: "12px 16px" }}>İş</th>
              <th style={{ padding: "12px 16px" }}>Plan</th>
              <th style={{ padding: "12px 16px" }}>Limitler</th>
              <th style={{ padding: "12px 16px" }}>Kayıt</th>
              <th style={{ padding: "12px 16px" }}>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map(ws => (
              <tr key={ws.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "12px 16px" }}>
                  <div>
                    <strong>{ws.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{ws.slug}</div>
                  </div>
                </td>
                <td style={{ padding: "12px 16px" }}>{ws.memberCount}</td>
                <td style={{ padding: "12px 16px" }}>{ws.jobCount}</td>
                <td style={{ padding: "12px 16px" }}>
                  <span className="tag" style={{
                    background: ws.plan === "scale" ? "#8b5cf6" : ws.plan === "growth" ? "#3b82f6" : "var(--bg-subtle)",
                    color: ws.plan !== "trial" ? "#fff" : "inherit"
                  }}>
                    {ws.plan}
                  </span>
                </td>
                <td style={{ padding: "12px 16px" }} className="muted">
                  {ws.monthlyJobLimit} iş/ay · {ws.parallelJobLimit} paralel
                </td>
                <td style={{ padding: "12px 16px" }} className="muted">
                  {new Date(ws.createdAt).toLocaleDateString("tr-TR")}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <select
                    defaultValue={ws.plan}
                    disabled={loading === ws.id}
                    onChange={(e) => changePlan(ws.id, e.target.value)}
                    style={{ fontSize: 13, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)" }}
                  >
                    {packages.map(pkg => (
                      <option key={pkg.plan_id} value={pkg.plan_id}>
                        {pkg.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
