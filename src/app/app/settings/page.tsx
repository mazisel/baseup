import Link from "next/link";
import { CreditCard, Database, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getCopy } from "@/lib/i18n";
import { listJobs } from "@/lib/jobs";
import { PLAN_LIMITS } from "@/lib/constants";
import { getPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { locale } = await getPreferences();
  const copy = getCopy(locale);
  const jobs = await listJobs(user);
  const limits = PLAN_LIMITS[user.plan];

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
          <strong>{limits.label}</strong>
        </div>
        <div className="stat">
          <span>{copy.settings.monthlyLimit}</span>
          <strong>{limits.monthlyJobs}</strong>
        </div>
        <div className="stat">
          <span>{copy.settings.parallelLimit}</span>
          <strong>{limits.parallelJobs}</strong>
        </div>
        <div className="stat">
          <span>{copy.settings.usage}</span>
          <strong>{jobs.length}</strong>
        </div>
      </section>

      <div className="module-grid">
        <Link href="/app/settings/team" className="module-card" style={{ textDecoration: "none", color: "inherit" }}>
          <ShieldCheck />
          <div>
            <h3>Team & Workspace</h3>
            <p>Manage members and their roles</p>
          </div>
          <span className="tag">Owner / Admin</span>
        </Link>

        <Link href="/app/settings/billing" className="module-card" style={{ textDecoration: "none", color: "inherit" }}>
          <CreditCard />
          <div>
            <h3>{copy.settings.billingTitle}</h3>
            <p>{copy.settings.billingDescription}</p>
          </div>
          <span className="tag">{copy.settings.billingTag}</span>
        </Link>

        <section className="module-card">
          <Database />
          <div>
            <h3>{copy.settings.dbTitle}</h3>
            <p>{copy.settings.dbDescription}</p>
          </div>
          <span className="tag">{copy.settings.dbTag}</span>
        </section>

        <section className="module-card">
          <ShieldCheck />
          <div>
            <h3>{copy.settings.credentialTitle}</h3>
            <p>{copy.settings.credentialDescription}</p>
          </div>
          <span className="tag">{copy.settings.credentialTag}</span>
        </section>
      </div>
    </div>
  );
}
