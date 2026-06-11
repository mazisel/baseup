import { redirect } from "next/navigation";
import Link from "next/link";
import { BarChart3, Users, Building2, ListTodo, ArrowLeft, Shield } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user || !isAdminEmail(user.email)) {
    redirect("/app");
  }

  return (
    <div className="app-layout">
      <aside className="sidebar" style={{ borderRight: "2px solid var(--error, #e53e3e)" }}>
        <div className="brand" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={20} style={{ color: "var(--error, #e53e3e)" }} />
          <span style={{ fontWeight: 700 }}>Super Admin</span>
        </div>
        <nav className="side-nav" aria-label="Admin Navigation">
          <Link href="/admin">
            <BarChart3 size={18} />
            Dashboard
          </Link>
          <Link href="/admin/users">
            <Users size={18} />
            Kullanıcılar
          </Link>
          <Link href="/admin/workspaces">
            <Building2 size={18} />
            Workspace'ler
          </Link>
          <Link href="/admin/jobs">
            <ListTodo size={18} />
            Tüm İşler
          </Link>
          <Link href="/admin/packages">
            <ListTodo size={18} />
            Paketler
          </Link>
          <Link href="/admin/coupons">
            <ListTodo size={18} />
            Kuponlar
          </Link>
        </nav>
        <div style={{ marginTop: "auto", padding: 16 }}>
          <Link href="/app" className="button ghost" style={{ width: "100%", fontSize: 13 }}>
            <ArrowLeft size={14} />
            Kullanıcı Paneline Dön
          </Link>
        </div>
      </aside>
      <main className="app-main">
        <div className="app-topbar" style={{ borderBottom: "2px solid var(--error, #e53e3e)" }}>
          <div>
            <strong style={{ color: "var(--error, #e53e3e)" }}>🔒 Super Admin Panel</strong>
            <div className="muted">{user.email}</div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
