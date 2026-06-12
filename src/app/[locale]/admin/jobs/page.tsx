import { getAdminJobs } from "@/lib/admin";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  const jobs = await getAdminJobs(200);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 32 }}>Tüm İşler</h1>
          <p className="muted">Platform genelindeki tüm görevler (son {jobs.length} adet)</p>
        </div>
      </div>

      <section className="panel">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "12px 16px" }}>İş Adı</th>
                <th style={{ padding: "12px 16px" }}>Workspace</th>
                <th style={{ padding: "12px 16px" }}>Durum</th>
                <th style={{ padding: "12px 16px" }}>Tip</th>
                <th style={{ padding: "12px 16px" }}>Kredi</th>
                <th style={{ padding: "12px 16px" }}>Oluşturulma</th>
                <th style={{ padding: "12px 16px" }}>Süre</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => {
                let duration = "—";
                if (j.startedAt && j.finishedAt) {
                  const ms = new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime();
                  const secs = Math.round(ms / 1000);
                  duration = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
                }

                return (
                  <tr key={j.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px" }}>
                      <div>
                        <strong>{j.title}</strong>
                        {j.errorMessage && (
                          <div style={{ fontSize: 11, color: "var(--error, #e53e3e)", marginTop: 2 }}>
                            {j.errorMessage.slice(0, 80)}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }} className="muted">{j.workspaceName}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge locale="tr" status={j.status} />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="tag">{j.type}</span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>{j.usageUnits}</td>
                    <td style={{ padding: "12px 16px" }} className="muted">
                      {new Date(j.createdAt).toLocaleString("tr-TR")}
                    </td>
                    <td style={{ padding: "12px 16px" }} className="muted">{duration}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
