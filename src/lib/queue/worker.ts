import { Worker, Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { runLegacyBridgeJob } from "../legacy-runner";
import type { MigrationJobPayload } from "./index";
import { sendJobCompletionEmail, sendMonitorAlertEmail } from "../emails";
import { checkMonitorUrl } from "../monitor-check";
import type { JobRequestInput } from "@/types/domain";

// "dry-run" modunda müşteri sunucusuna dokunulmaz; iş akışı, loglar ve durum
// geçişleri simüle edilir. Gerçek çalıştırma için SAAS_RUNNER_MODE=legacy gerekir.
const RUNNER_MODE = process.env.SAAS_RUNNER_MODE === "legacy" ? "legacy" : "dry-run";

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
      const { jobId, inputs } = job.data;

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
      let jobTitle = "Database Migration";

      try {
        // Fetch job details to get user ID and title
        const { data: jobRecord } = await supabase.from("job_runs").select("created_by, title").eq("id", jobId).single();
        if (jobRecord && jobRecord.created_by) {
          jobTitle = jobRecord.title;
          // Fetch user email using Admin API
          const { data: authUser } = await supabase.auth.admin.getUserById(jobRecord.created_by);
          if (authUser && authUser.user) {
            userEmail = authUser.user.email || "";
          }
        }

        await log("info", `Job ${jobId} picked up by background worker (mode: ${RUNNER_MODE})`);

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
        await log("error", `Migration failed: ${message}`);
        await supabase.from("job_runs").update({ status: "error", error_message: message, finished_at: new Date().toISOString() }).eq("id", jobId);

        if (userEmail) {
          await sendJobCompletionEmail(userEmail, jobTitle, "error", message);
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
