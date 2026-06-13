import Link from "next/link";
import { CreditCard, Server, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getCopy } from "@/lib/i18n";
import { listJobs } from "@/lib/jobs";
import { getPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { locale } = await getPreferences();
  const copy = getCopy(locale);
  const jobs = await listJobs(user);
  const canManageTeam = user.role === "owner" || user.role === "admin";
  const canManageServers = ["owner", "admin", "operator"].includes(user.role);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.settings.title}</h1>
          <p className="muted">{copy.settings.description}</p>
        </div>
      </div>

      <section className="stats-grid">
        <div className="stat">
          <span>{copy.settings.plan}</span>
          <strong>{formatPlanName(user.plan)}</strong>
        </div>
        <div className="stat">
          <span>{copy.settings.monthlyLimit}</span>
          <strong>{user.monthlyJobLimit}</strong>
        </div>
        <div className="stat">
          <span>{copy.settings.parallelLimit}</span>
          <strong>{user.parallelJobLimit}</strong>
        </div>
        <div className="stat">
          <span>{copy.settings.usage}</span>
          <strong>{jobs.length}</strong>
        </div>
      </section>

      <div className="module-grid">
        {canManageTeam ? (
          <Link href="/app/settings/team" className="module-card" style={{ textDecoration: "none", color: "inherit" }}>
            <ShieldCheck />
            <div>
              <h3>{copy.settings.teamTitle}</h3>
              <p>{copy.settings.teamDescription}</p>
            </div>
            <span className="tag">{copy.settings.teamTag}</span>
          </Link>
        ) : null}

        <Link href="/app/settings/billing" className="module-card" style={{ textDecoration: "none", color: "inherit" }}>
          <CreditCard />
          <div>
            <h3>{copy.settings.billingTitle}</h3>
            <p>{copy.settings.billingDescription}</p>
          </div>
          <span className="tag">{copy.settings.billingTag}</span>
        </Link>

        {canManageServers ? (
          <Link href="/app/settings/servers" className="module-card" style={{ textDecoration: "none", color: "inherit" }}>
            <Server />
            <div>
              <h3>{copy.settings.serversTitle}</h3>
              <p>{copy.settings.serversDescription}</p>
            </div>
            <span className="tag">{copy.settings.serversTag}</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function formatPlanName(plan: string) {
  return plan
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Trial";
}
