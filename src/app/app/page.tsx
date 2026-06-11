import Link from "next/link";
import { Plus } from "lucide-react";
import { getModules } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { getCopy } from "@/lib/i18n";
import { listJobs } from "@/lib/jobs";
import { getPreferences } from "@/lib/preferences";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { locale } = await getPreferences();
  const copy = getCopy(locale);
  const modules = getModules(locale);
  const jobs = await listJobs(user);
  const running = jobs.filter(job => job.status === "running").length;
  const completed = jobs.filter(job => job.status === "success").length;
  const failed = jobs.filter(job => job.status === "error").length;
  const limit = user.monthlyJobLimit;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 38 }}>{copy.dashboard.title}</h1>
          <p className="muted">{copy.dashboard.description}</p>
        </div>
        <Link className="button primary" href="/app/new-job">
          <Plus size={17} />
          {copy.dashboard.newJob}
        </Link>
      </div>

      <section className="stats-grid">
        <div className="stat">
          <span>{copy.dashboard.monthUsage}</span>
          <strong>{jobs.length}/{limit}</strong>
        </div>
        <div className="stat">
          <span>{copy.dashboard.running}</span>
          <strong>{running}</strong>
        </div>
        <div className="stat">
          <span>{copy.dashboard.completed}</span>
          <strong>{completed}</strong>
        </div>
        <div className="stat">
          <span>{copy.dashboard.failed}</span>
          <strong>{failed}</strong>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="page-head">
          <div>
            <h2>{copy.dashboard.servicesTitle}</h2>
            <p className="muted">{copy.dashboard.servicesDescription}</p>
          </div>
        </div>
        <div className="module-grid">
          {modules.map(module => {
            const Icon = module.icon;
            return (
              <article className="module-card" key={module.id}>
                <Icon />
                <div>
                  <h3>{module.title}</h3>
                  <p>{module.description}</p>
                </div>
                <div className="meta-row">
                  <span className="tag">{module.badge}</span>
                  <span className="tag">{module.usageUnits} kredi</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="page-head">
          <div>
            <h2>{copy.dashboard.recentJobs}</h2>
            <p className="muted">{copy.dashboard.recentDescription}</p>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="empty-state">
            <h3>{copy.dashboard.emptyTitle}</h3>
            <p className="muted">{copy.dashboard.emptyDescription}</p>
            <Link className="button primary" href="/app/new-job">{copy.dashboard.startJob}</Link>
          </div>
        ) : (
          <div className="table-list">
            {jobs.map(job => (
              <Link className="table-row" href={`/app/jobs/${job.id}`} key={job.id}>
                <div>
                  <strong>{job.title}</strong>
                  <div className="muted">{new Date(job.createdAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}</div>
                </div>
                <StatusBadge locale={locale} status={job.status} />
                <span className="muted">{job.summary.target || job.summary.source || copy.dashboard.sanitizedJob}</span>
                <span className="tag">{job.summary.runnerMode}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
