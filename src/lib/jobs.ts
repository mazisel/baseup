import { getModuleMetaForLocale } from "@/lib/constants";
import { assertNoPersistedSecrets, buildSafeSummary } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { migrationQueue } from "@/lib/queue";
import type { Locale } from "@/lib/preference-shared";
import type { AppUser, JobRequestInput } from "@/types/domain";

const RUNNER_MODE = process.env.SAAS_RUNNER_MODE === "legacy" ? "legacy" : "dry-run";
const QUEUE_ADD_TIMEOUT_MS = 5_000;

export class JobQueueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobQueueUnavailableError";
  }
}

export function hasReadyWorkspace(user: AppUser) {
  return user.workspace.id !== "pending";
}

export async function listJobs(user: AppUser) {
  // Workspace trigger'ı henüz çalışmadıysa sahte "pending" id ile sorgu atma (uuid hatası verir).
  if (!hasReadyWorkspace(user)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_runs")
    .select("*")
    .eq("workspace_id", user.workspace.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`İş listesi alınamadı: ${error.message}`);
  }

  // Map to the domain type structure if needed, or just return as is
  return (data || []).map(row => ({
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    type: row.type,
    title: row.title,
    status: row.status,
    summary: row.sanitized_summary,
    logs: [],
    usageUnits: row.usage_units,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  }));
}

export async function getJob(jobId: string, user: AppUser) {
  if (!hasReadyWorkspace(user)) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("job_runs")
    .select("*")
    .eq("id", jobId)
    .eq("workspace_id", user.workspace.id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    createdBy: data.created_by,
    type: data.type,
    title: data.title,
    status: data.status,
    summary: data.sanitized_summary,
    logs: [],
    usageUnits: data.usage_units,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
    errorMessage: data.error_message,
  };
}

export type JobQuotaCheck =
  | { ok: true }
  | { ok: false; status: number; error: string };

// Aylık ve paralel iş limitleri. Hem yeni iş hem retry bu kontrolden geçmeli;
// aksi halde retry ucu plan limitlerini bypass eder.
export async function checkJobQuota(user: AppUser, locale: Locale): Promise<JobQuotaCheck> {
  const jobs = await listJobs(user);

  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);
  const monthlyJobs = jobs.filter(j => new Date(j.createdAt) >= thisMonth).length;

  if (monthlyJobs >= user.monthlyJobLimit) {
    return {
      ok: false,
      status: 403,
      error: locale === "tr"
        ? `Aylık iş limitinize (${user.monthlyJobLimit}) ulaştınız. Planınızı yükseltin.`
        : `You've reached your monthly job limit (${user.monthlyJobLimit}). Please upgrade your plan.`,
    };
  }

  const runningJobs = jobs.filter(j => j.status === "running" || j.status === "queued").length;
  if (runningJobs >= user.parallelJobLimit) {
    return {
      ok: false,
      status: 429,
      error: locale === "tr"
        ? `Aynı anda en fazla ${user.parallelJobLimit} iş çalıştırabilirsiniz. Mevcut işlerinizin tamamlanmasını bekleyin.`
        : `You can run up to ${user.parallelJobLimit} jobs simultaneously. Wait for current jobs to finish.`,
    };
  }

  return { ok: true };
}

export async function createJob(input: JobRequestInput, user: AppUser, locale: Locale = "tr") {
  const moduleMeta = getModuleMetaForLocale(input.type, locale);
  const summary = buildSafeSummary(input, RUNNER_MODE);
  assertNoPersistedSecrets(summary);

  const supabase = await createClient();

  const { data: job, error } = await supabase
    .from("job_runs")
    .insert({
      workspace_id: user.workspace.id,
      created_by: user.id,
      type: input.type,
      title: moduleMeta.title,
      status: "queued",
      sanitized_summary: summary,
      usage_units: moduleMeta.usageUnits,
    })
    .select()
    .single();

  if (error || !job) {
    throw new Error(`Failed to create job: ${error?.message}`);
  }

  // Push to BullMQ. Redis erişilemezse istek askıda kalmasın: kısa timeout ile dene,
  // başaramazsan işi DB'de "error" olarak işaretle ve hayalet "queued" kaydı bırakma.
  try {
    await withTimeout(
      migrationQueue.add("migration-job", {
        jobId: job.id,
        workspaceId: user.workspace.id,
        type: input.type,
        inputs: input, // Be careful not to log this entirely in workers to avoid leaking secrets
      }, {
        jobId: job.id,
      }),
      QUEUE_ADD_TIMEOUT_MS,
      "Kuyruk (Redis) zaman aşımına uğradı"
    );
  } catch (queueError) {
    const reason = queueError instanceof Error ? queueError.message : "Bilinmeyen kuyruk hatası";
    console.error(`[jobs] İş kuyruğa eklenemedi (job ${job.id}):`, reason);

    const failureMessage = locale === "tr"
      ? "İş kuyruğuna ulaşılamadı (Redis kapalı olabilir). İş başlatılamadı."
      : "Job queue is unreachable (Redis may be down). The job could not be started.";

    // Sistem operasyonu: kullanıcı oturumunun RLS'i job_runs UPDATE'e izin vermez,
    // kayıt sessizce "queued" kalır. Bu yüzden service role ile işaretle.
    try {
      const adminClient = getSupabaseAdminClient();
      await adminClient
        .from("job_runs")
        .update({ status: "error", error_message: failureMessage, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      await adminClient.from("job_events").insert({
        job_id: job.id,
        level: "error",
        message: failureMessage,
      });
    } catch (markError) {
      console.error(`[jobs] İş "error" olarak işaretlenemedi (job ${job.id}):`, markError);
    }

    throw new JobQueueUnavailableError(failureMessage);
  }

  return {
    id: job.id,
    workspaceId: job.workspace_id,
    createdBy: job.created_by,
    type: job.type,
    title: job.title,
    status: job.status,
    summary: job.sanitized_summary,
    logs: [],
    usageUnits: job.usage_units,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export async function retryJob(jobId: string, user: AppUser, locale: Locale = "tr") {
  const previousJob = await getJob(jobId, user);
  if (!previousJob) return null;

  const retryInput: JobRequestInput = {
    type: previousJob.type as JobRequestInput["type"],
    targetHost: previousJob.summary?.target,
    sourceHost: previousJob.summary?.source,
    targetInstance: previousJob.summary?.targetInstance,
    dryRun: true
  };

  const job = await createJob(retryInput, user, locale);

  const supabase = await createClient();
  await supabase.from("job_events").insert({
    job_id: job.id,
    level: "warn",
    message: locale === "tr"
      ? "Güvenlik politikası gereği erişim bilgileri saklanmadı. Gerçek tekrar çalıştırma için bilgileri yeniden girin."
      : "Access details were not stored by policy. Enter them again to rerun the real service."
  });

  return job;
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}
