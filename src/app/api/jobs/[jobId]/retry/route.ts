import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { retryJob, checkJobQuota, hasReadyWorkspace, JobQueueUnavailableError } from "@/lib/jobs";
import { getPreferences } from "@/lib/preferences";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { locale } = await getPreferences();

  // Retry de yeni bir iş oluşturur: rate limit ve plan limitleri aynen uygulanmalı,
  // yoksa bu uç üzerinden tüm limitler bypass edilebilir.
  const { ok } = rateLimit(`jobs:${user.id}`);
  if (!ok) {
    return NextResponse.json(
      { error: locale === "tr" ? "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin." : "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  if (!hasReadyWorkspace(user)) {
    return NextResponse.json({
      error: locale === "tr"
        ? "Çalışma alanınız henüz hazırlanıyor. Lütfen birkaç saniye sonra tekrar deneyin."
        : "Your workspace is still being prepared. Please try again in a few seconds."
    }, { status: 409 });
  }

  const { jobId } = await context.params;

  try {
    const quota = await checkJobQuota(user, locale);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: quota.status });
    }

    const job = await retryJob(jobId, user, locale);

    if (!job) {
      return NextResponse.json({ error: locale === "tr" ? "Job bulunamadı" : "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof JobQueueUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: { "Retry-After": "30" } });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/jobs/retry] Retry hatası:", message);
    return NextResponse.json({
      error: locale === "tr" ? "İş tekrar başlatılamadı. Lütfen tekrar deneyin." : "Failed to retry the job. Please try again."
    }, { status: 500 });
  }
}
