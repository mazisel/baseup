import { getAdminUsers } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await getAdminUsers();

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 32 }}>Kullanıcılar</h1>
          <p className="muted">Platformdaki tüm kayıtlı kullanıcılar ({users.length} kişi)</p>
        </div>
      </div>

      <section className="panel">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "12px 16px" }}>Kullanıcı</th>
                <th style={{ padding: "12px 16px" }}>Workspace</th>
                <th style={{ padding: "12px 16px" }}>Plan</th>
                <th style={{ padding: "12px 16px" }}>Rol</th>
                <th style={{ padding: "12px 16px" }}>Kayıt</th>
                <th style={{ padding: "12px 16px" }}>Son Giriş</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div>
                      <strong>{u.name}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>{u.workspaceName}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span className="tag" style={{
                      background: u.plan === "scale" ? "#8b5cf6" : u.plan === "growth" ? "#3b82f6" : "var(--bg-subtle)",
                      color: u.plan !== "trial" ? "#fff" : "inherit"
                    }}>
                      {u.plan}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>{u.role}</td>
                  <td style={{ padding: "12px 16px" }} className="muted">
                    {new Date(u.createdAt).toLocaleDateString("tr-TR")}
                  </td>
                  <td style={{ padding: "12px 16px" }} className="muted">
                    {u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString("tr-TR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
