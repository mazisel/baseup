import Link from "next/link";
import { BarChart3, Plus, Settings, Activity } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { PreferenceControls } from "@/components/preference-controls";
import type { AppCopy } from "@/lib/i18n";
import type { Locale, Theme } from "@/lib/preference-shared";
import type { AppUser } from "@/types/domain";

export function AppShell({
  user,
  locale,
  theme,
  copy,
  children
}: {
  user: AppUser;
  locale: Locale;
  theme: Theme;
  copy: AppCopy;
  children: React.ReactNode;
}) {
  const workspaceName = user.workspace.slug === "demo" ? copy.misc.demoWorkspace : user.workspace.name;
  const roleLabel = user.role === "owner" ? copy.misc.owner : user.role;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link className="brand" href="/app">
          <BrandLogo name={copy.brand} />
        </Link>
        <nav className="side-nav" aria-label={copy.nav.dashboard}>
          <Link className="active" href="/app">
            <BarChart3 size={18} />
            {copy.nav.dashboard}
          </Link>
          {user.role !== 'viewer' && (
            <Link href="/app/new-job">
              <Plus size={18} />
              {copy.nav.newJob}
            </Link>
          )}
          {user.role !== 'viewer' && (
            <Link href="/app/monitors">
              <Activity size={18} />
              Monitors
            </Link>
          )}
          <Link href="/app/settings">
            <Settings size={18} />
            {copy.nav.settings}
          </Link>
        </nav>
      </aside>
      <main className="app-main">
        <div className="app-topbar">
          <div>
            <strong>{workspaceName}</strong>
            <div className="muted">{roleLabel} · {user.plan}</div>
          </div>
          <div className="nav-actions">
            <PreferenceControls copy={copy.preferences} locale={locale} theme={theme} />
            <div className="user-chip">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span>{user.email}</span>
            </div>
            <LogoutButton label={copy.nav.logout} />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
