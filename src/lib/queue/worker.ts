import { UnrecoverableError, Worker, Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { LegacyBridgeUnavailableError, runLegacyBridgeJob } from "../legacy-runner";
import type { MigrationJobPayload } from "./index";
import { sendJobCompletionEmail, sendMonitorAlertEmail } from "../emails";
import { checkMonitorUrl } from "../monitor-check";
import type { JobRequestInput } from "@/types/domain";

// "dry-run" modunda müşteri sunucusuna dokunulmaz; iş akışı, loglar ve durum
// geçişleri simüle edilir. Gerçek çalıştırma için SAAS_RUNNER_MODE=legacy gerekir.
const RUNNER_MODE = process.env.SAAS_RUNNER_MODE === "legacy" ? "legacy" : "dry-run";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => Math.min(times * 1_000, 30_000),
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key" // We need a service role key to insert logs bypassing RLS
);

export function startWorker() {
  const worker = new Worker<MigrationJobPayload>(
    "migration-jobs",
    async (job: Job<MigrationJobPayload>) => {
      const { inputs } = job.data;
      const jobId = resolveJobRunId(job);

      if (!jobId) {
        console.warn(`[worker] DB job id bulunmayan kuyruk işi atlandı (bullmq job ${job.id ?? "unknown"})`);
        throw new UnrecoverableError("Queue payload does not contain a valid job_runs id");
      }

      // Redis kalıcı olduğu için Supabase reset/migration sonrası eski kuyruk
      // payload'ları kalabilir. DB kaydı yoksa log yazmaya çalışıp FK spam'i üretme.
      const { data: jobRecord, error: jobRecordError } = await supabase
        .from("job_runs")
        .select("created_by, title")
        .eq("id", jobId)
        .maybeSingle();

      if (jobRecordError) {
        throw new Error(`Job kaydı okunamadı (${jobId}): ${jobRecordError.message}`);
      }

      if (!jobRecord) {
        console.warn(`[worker] DB kaydı bulunmayan kuyruk işi atlandı (bullmq job ${job.id ?? "unknown"}, job_runs ${jobId})`);
        throw new UnrecoverableError(`Job run ${jobId} does not exist`);
      }

      async function log(level: string, message: string) {
        const { error } = await supabase.from("job_events").insert({
          job_id: jobId,
          level,
          message,
        });
        if (error) {
          console.error(`[worker] Log yazılamadı (job ${jobId}):`, error.message);
        }
      }

      let userEmail = "";
      const jobTitle = jobRecord.title || "Database Migration";

      try {
        if (jobRecord.created_by) {
          const { data: authUser } = await supabase.auth.admin.getUserById(jobRecord.created_by);
          if (authUser && authUser.user) {
            userEmail = authUser.user.email || "";
          }
        }

        await log("info", `İşlem ${jobId} arka plan servisi tarafından alındı (mod: ${RUNNER_MODE})`);

        await supabase.from("job_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);

        if (RUNNER_MODE === "dry-run") {
          // Güvenli mod: müşteri sunucusuna bağlanmadan akışı simüle et.
          await runDryRunJob(jobId, inputs as JobRequestInput, log);
        } else {
          // Execute actual work via Legacy Bridge
          await runLegacyBridgeJob(jobId, inputs as JobRequestInput, async (id, level, message) => {
            await log(level, message);
          });
        }

        await log("success", "Tüm işlemler başarıyla tamamlandı");

        await supabase.from("job_runs").update({ status: "success", finished_at: new Date().toISOString() }).eq("id", jobId);

        if (userEmail) {
          await sendJobCompletionEmail(userEmail, jobTitle, "success");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        // SSH kimlik doğrulama hatası kalıcıdır: yeniden denemek sonucu değiştirmez,
        // üstelik müşteri sunucusunda fail2ban/lockout tetikleyebilir.
        const isAuthFailure = /all configured authentication methods failed|permission denied|authentication failed/i.test(message);
        const userFacingMessage = error instanceof LegacyBridgeUnavailableError
          ? message
          : `Migration failed: ${message}`;
        await log("error", userFacingMessage);
        if (isAuthFailure) {
          await log("warn", "🔐 SSH kimlik doğrulaması reddedildi. Root şifresini kontrol edip işi yeniden başlatın; bu hata kalıcı olduğu için otomatik tekrar denenmeyecek.");
        }
        await supabase.from("job_runs").update({ status: "error", error_message: message, finished_at: new Date().toISOString() }).eq("id", jobId);

        const isLastAttempt = isAuthFailure || error instanceof LegacyBridgeUnavailableError || job.attemptsMade >= (job.opts.attempts || 1) - 1;
        if (userEmail && isLastAttempt) {
          await sendJobCompletionEmail(userEmail, jobTitle, "error", message);
        }
        if (isAuthFailure || error instanceof LegacyBridgeUnavailableError) {
          throw new UnrecoverableError(message);
        }
        throw error;
      }
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} tamamlandı`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} başarısız: ${err.message}`);
  });

  worker.on("error", (error) => {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(`[worker:migration-jobs] Redis bağlantı hatası${code ? ` (${code})` : ""}: ${error.message}`);
  });

  return worker;
}

function resolveJobRunId(job: Job<MigrationJobPayload>) {
  const payloadJobId = job.data?.jobId;
  if (typeof payloadJobId === "string" && UUID_PATTERN.test(payloadJobId)) {
    return payloadJobId;
  }
  if (typeof job.id === "string" && UUID_PATTERN.test(job.id)) {
    return job.id;
  }
  return null;
}

async function runDryRunJob(
  jobId: string,
  input: JobRequestInput,
  log: (level: string, message: string) => Promise<void>
) {
  const steps: Array<[string, string]> = [
    ["step", "Dry-run modu aktif: müşteri sunucusuna bağlanılmayacak."],
    ["info", `Modül: ${input?.type || "bilinmiyor"}`],
    ["info", input?.targetHost ? `Hedef sunucu (simülasyon): ${input.targetHost}` : "Hedef sunucu belirtilmedi."],
    ["step", "Bağlantı parametreleri doğrulanıyor (simülasyon)..."],
    ["step", "Komutlar hazırlanıyor (simülasyon)..."],
    ["info", "Gerçek çalıştırma için sunucuda SAAS_RUNNER_MODE=legacy ayarlayın."],
  ];

  for (const [level, message] of steps) {
    await log(level, message);
    await sleep(400);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function startCronJobs() {
  // Run every 5 minutes
  setInterval(async () => {
    let monitors: Array<{
      id: string;
      workspace_id: string;
      name: string;
      url: string;
      status: string;
    }> | null = null;

    try {
      const { data, error } = await supabase
        .from("health_monitors")
        .select("*")
        .neq("status", "paused");
      if (error) {
        console.error("[cron] Monitör listesi alınamadı:", error.message);
        return;
      }
      monitors = data;
    } catch (e) {
      console.error("[cron] Monitör listesi hatası:", e instanceof Error ? e.message : e);
      return;
    }

    if (!monitors) return;

    for (const m of monitors) {
      // Tek bir monitördeki hata diğer monitörlerin kontrolünü engellemesin.
      try {
        const check = await checkMonitorUrl(m.url);
        const newStatus = check.status;

        // Down'a düşünce ve tekrar up olunca bildirim gönder.
        const wentDown = m.status !== "down" && newStatus === "down";
        const recovered = m.status === "down" && newStatus === "up";
        if (wentDown || recovered) {
          const { data: member } = await supabase.from("memberships").select("user_id").eq("workspace_id", m.workspace_id).limit(1).single();
          if (member) {
            const { data: authUser } = await supabase.auth.admin.getUserById(member.user_id);
            const email = authUser?.user?.email;
            if (email) {
              await sendMonitorAlertEmail(email, m.name, m.url, newStatus, wentDown ? check.errorMessage : undefined);
            }
          }
        }

        // update monitor
        const { error: updateError } = await supabase.from("health_monitors").update({
          status: newStatus,
          last_checked_at: new Date().toISOString()
        }).eq("id", m.id);
        if (updateError) {
          console.error(`[cron] Monitör güncellenemedi (${m.id}):`, updateError.message);
        }

        // insert event
        const { error: eventError } = await supabase.from("health_events").insert({
          monitor_id: m.id,
          status: newStatus,
          response_time_ms: check.responseTimeMs,
          error_message: check.errorMessage
        });
        if (eventError) {
          console.error(`[cron] Monitör olayı yazılamadı (${m.id}):`, eventError.message);
        }
      } catch (e) {
        console.error(`[cron] Monitör kontrolü başarısız (${m.id}):`, e instanceof Error ? e.message : e);
      }
    }
  }, 5 * 60 * 1000); // 5 mins
}
