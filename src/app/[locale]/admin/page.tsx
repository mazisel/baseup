import { getAdminStats } from "@/lib/admin";
import { Activity, Users, Building2, ListTodo, Zap, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const stats = await getAdminStats();

  const cards = [
    { label: "Toplam Kullanıcı", value: stats.totalUsers, icon: Users, color: "#3b82f6" },
    { label: "Workspace Sayısı", value: stats.totalWorkspaces, icon: Building2, color: "#8b5cf6" },
    { label: "Toplam İş", value: stats.totalJobs, icon: ListTodo, color: "#10b981" },
    { label: "Aktif İş", value: stats.runningJobs, icon: Activity, color: "#f59e0b" },
    { label: "Hatalı İş", value: stats.failedJobs, icon: AlertTriangle, color: "#ef4444" },
    { label: "Son 24 Saat", value: stats.last24h, icon: Zap, color: "#06b6d4" },
  ];

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 32 }}>Admin Dashboard</h1>
          <p className="muted">Platform genelindeki istatistikler</p>
        </div>
      </div>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div className="stat" key={card.label} style={{ position: "relative", overflow: "hidden" }}>
              <Icon size={40} style={{ position: "absolute", right: 12, top: 12, opacity: 0.08, color: card.color }} />
              <span>{card.label}</span>
              <strong style={{ fontSize: 36, color: card.color }}>{card.value}</strong>
            </div>
          );
        })}
      </section>

      <section className="panel" style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 12 }}>Hızlı Erişim</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <a href="/admin/users" className="button secondary" style={{ justifyContent: "center" }}>
            <Users size={16} /> Kullanıcıları Yönet
          </a>
          <a href="/admin/workspaces" className="button secondary" style={{ justifyContent: "center" }}>
            <Building2 size={16} /> Workspace & Plan Yönetimi
          </a>
          <a href="/admin/jobs" className="button secondary" style={{ justifyContent: "center" }}>
            <ListTodo size={16} /> Tüm İşleri Görüntüle
          </a>
        </div>
      </section>
    </div>
  );
}
