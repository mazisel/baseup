import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { JobStream } from "@/components/job-stream";
import { getCurrentUser } from "@/lib/auth";
import { getCopy } from "@/lib/i18n";
import { getJob } from "@/lib/jobs";
import { getPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    jobId: string;
  }>;
};

export default async function JobDetailPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { locale } = await getPreferences();
  const copy = getCopy(locale);
  const { jobId } = await params;
  const job = await getJob(jobId, user);
  if (!job) notFound();

  return (
    <div className="content">
      <Link className="button ghost" href="/app" style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} />
        {copy.job.back}
      </Link>
      <JobStream initialJob={job} locale={locale} />
    </div>
  );
}
