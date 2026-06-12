import Link from "next/link";
import { Plus } from "lucide-react";
import { Suspense } from "react";
import { getModules } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { getCopy, type AppCopy } from "@/lib/i18n";
import { listJobs } from "@/lib/jobs";
import { getPreferences } from "@/lib/preferences";
import { StatusBadge } from "@/components/status-badge";
import type { Locale } from "@/lib/preference-shared";

type JobsPromise = ReturnType<typeof listJobs>;

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [user, { locale }] = await Promise.all([
    getCurrentUser(),
    getPreferences()
  ]);
  
  if (!user) return null;

  const copy = getCopy(locale);
  const modules = getModules(locale);
  const jobsPromise = listJobs(user);
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

      <Suspense fallback={
        <section className="stats-grid">
          <div className="stat"><span>{copy.dashboard.monthUsage}</span><strong>...</strong></div>
          <div className="stat"><span>{copy.dashboard.running}</span><strong>...</strong></div>
          <div className="stat"><span>{copy.dashboard.completed}</span><strong>...</strong></div>
          <div className="stat"><span>{copy.dashboard.failed}</span><strong>...</strong></div>
        </section>
      }>
        <DashboardStats jobsPromise={jobsPromise} limit={limit} copy={copy} />
      </Suspense>



      <Suspense fallback={<section className="panel"><div className="page-head"><div><h2>{copy.dashboard.recentJobs}</h2><p className="muted">Yükleniyor...</p></div></div></section>}>
        <RecentJobs jobsPromise={jobsPromise} locale={locale} copy={copy} />
      </Suspense>
    </div>
  );
}

async function DashboardStats({ jobsPromise, limit, copy }: { jobsPromise: JobsPromise; limit: number; copy: AppCopy }) {
  const jobs = await jobsPromise;
  const running = jobs.filter(job => job.status === "running").length;
  const completed = jobs.filter(job => job.status === "success").length;
  const failed = jobs.filter(job => job.status === "error").length;

  return (
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
  );
}

async function RecentJobs({ jobsPromise, locale, copy }: { jobsPromise: JobsPromise; locale: Locale; copy: AppCopy }) {
  const jobs = await jobsPromise;

  return (
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
          {jobs.slice(0, 10).map(job => (
            <Link className="table-row" href={`/app/jobs/${job.id}`} key={job.id}>
              <div>
                <strong>{job.type ? (getModules(locale).find(m => m.id === job.type)?.title || job.title) : job.title}</strong>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{new Date(job.createdAt).toLocaleString(locale === "tr" ? "tr-TR" : "en-US")}</div>
              </div>
              <StatusBadge locale={locale} status={job.status} />
              <span className="muted">{job.summary?.target || job.summary?.source || copy.dashboard.sanitizedJob}</span>
              <span className="tag">{job.summary?.runnerMode || "legacy"}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
