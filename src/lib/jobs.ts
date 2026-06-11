import { getModuleMetaForLocale } from "@/lib/constants";
import { assertNoPersistedSecrets, buildSafeSummary } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { migrationQueue } from "@/lib/queue";
import type { Locale } from "@/lib/preference-shared";
import type { AppUser, JobRequestInput } from "@/types/domain";

const RUNNER_MODE = process.env.SAAS_RUNNER_MODE === "legacy" ? "legacy" : "dry-run";

export async function listJobs(user: AppUser) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_runs")
    .select("*")
    .eq("workspace_id", user.workspace.id)
    .order("created_at", { ascending: false });

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

  // Push to BullMQ
  await migrationQueue.add("migration-job", {
    jobId: job.id,
    workspaceId: user.workspace.id,
    type: input.type,
    inputs: input, // Be careful not to log this entirely in workers to avoid leaking secrets
  });

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
    type: previousJob.type as any,
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
