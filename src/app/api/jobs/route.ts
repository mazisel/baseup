import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createJob, listJobs, checkJobQuota, hasReadyWorkspace, JobQueueUnavailableError } from "@/lib/jobs";
import { MODULE_DEFINITIONS } from "@/lib/constants";
import { getPreferences } from "@/lib/preferences";
import { rateLimit } from "@/lib/rate-limit";
import type { JobRequestInput } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ jobs: await listJobs(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting: dakikada max 20 istek
  const { ok, remaining } = rateLimit(`jobs:${user.id}`);
  if (!ok) {
    return NextResponse.json(
      { error: "Çok fazla istek gönderdiniz. Lütfen biraz bekleyin." },
      { status: 429, headers: { "Retry-After": "60", "X-RateLimit-Remaining": String(remaining) } }
    );
  }

  const input = await request.json().catch(() => null) as JobRequestInput | null;
  const { locale } = await getPreferences();
  if (!input || !MODULE_DEFINITIONS.some(module => module.id === input.type)) {
    return NextResponse.json({
      error: locale === "tr" ? "Geçersiz işlem tipi" : "Invalid operation type"
    }, { status: 400 });
  }

  if (!hasReadyWorkspace(user)) {
    return NextResponse.json({
      error: locale === "tr"
        ? "Çalışma alanınız henüz hazırlanıyor. Lütfen birkaç saniye sonra tekrar deneyin."
        : "Your workspace is still being prepared. Please try again in a few seconds."
    }, { status: 409 });
  }

  const normalizedInput = normalizeJobInput(input);

  try {
    const quota = await checkJobQuota(user, locale);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: quota.status });
    }

    const job = await createJob(normalizedInput, user, locale);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof JobQueueUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503, headers: { "Retry-After": "30" } });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/jobs] İş oluşturma hatası:", message);
    return NextResponse.json({
      error: locale === "tr" ? "İş oluşturulamadı. Lütfen tekrar deneyin." : "Failed to create the job. Please try again."
    }, { status: 500 });
  }
}

function normalizeJobInput(input: JobRequestInput): JobRequestInput {
  if (!requiresExplicitDataMigration(input.type)) return input;

  const migrateData = input.migrateData === true;
  return {
    ...input,
    migrateData,
    migrateStorage: migrateData && input.migrateStorage === true,
    skipData: !migrateData,
  };
}

function requiresExplicitDataMigration(type: JobRequestInput["type"]) {
  return type === "self_hosted_migration" || type === "cloud_to_self_hosted";
}
