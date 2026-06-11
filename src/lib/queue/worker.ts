import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { runLegacyBridgeJob } from "../legacy-runner";
import type { MigrationJobPayload } from "./index";
import { sendJobCompletionEmail } from "../emails";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "dummy-key" // We need a service role key to insert logs bypassing RLS
);

export function startWorker() {
  const worker = new Worker<MigrationJobPayload>(
    "migration-jobs",
    async (job: Job<MigrationJobPayload>) => {
      const { jobId, workspaceId, type, inputs } = job.data;
      let userEmail = "";
      let jobTitle = "Database Migration";

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

      async function log(level: string, message: string) {
        await supabase.from("job_events").insert({
          job_id: jobId,
          level,
          message,
        });
      }

      await log("info", `Job ${jobId} picked up by background worker`);

      try {
        await supabase.from("job_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);

        // Execute actual work via Legacy Bridge
        await runLegacyBridgeJob(jobId, inputs as import("@/types/domain").JobRequestInput, async (id, level, message) => {
          await log(level, message);
        });

        await log("success", "Tüm işlemler başarıyla tamamlandı");

        await supabase.from("job_runs").update({ status: "success", finished_at: new Date().toISOString() }).eq("id", jobId);
        
        if (userEmail) {
          await sendJobCompletionEmail(userEmail, jobTitle, "success");
        }
      } catch (error: any) {
        await log("error", `Migration failed: ${error.message}`);
        await supabase.from("job_runs").update({ status: "error", error_message: error.message, finished_at: new Date().toISOString() }).eq("id", jobId);
        
        if (userEmail) {
          await sendJobCompletionEmail(userEmail, jobTitle, "error", error.message);
        }
        throw error;
      }
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log(`Job with id ${job.id} has been completed`);
  });

  worker.on("failed", (job, err) => {
    console.log(`Job with id ${job?.id} has failed with ${err.message}`);
  });

  return worker;
}

export function startCronJobs() {
  // Run every 5 minutes
  setInterval(async () => {
    try {
      const { data: monitors } = await supabase
        .from("health_monitors")
        .select("*")
        .neq("status", "paused");

      if (!monitors) return;

      for (const m of monitors) {
        const start = Date.now();
        let isUp = false;
        let errorMsg = "";

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
          
          const res = await fetch(m.url, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (res.ok) {
            isUp = true;
          } else {
            errorMsg = `HTTP ${res.status}`;
          }
        } catch (err: any) {
          errorMsg = err.name === 'AbortError' ? 'Timeout' : err.message;
        }

        const ms = Date.now() - start;
        const newStatus = isUp ? "up" : "down";

        // If status changed to down, we should send an email!
        if (m.status !== "down" && newStatus === "down") {
          // get user email
          const { data: member } = await supabase.from("memberships").select("user_id").eq("workspace_id", m.workspace_id).limit(1).single();
          if (member) {
            const { data: authUser } = await supabase.auth.admin.getUserById(member.user_id);
            if (authUser && authUser.user && authUser.user.email) {
              await sendJobCompletionEmail(authUser.user.email, `Uptime Alert: ${m.name}`, "error", `Monitor ${m.url} is DOWN. Error: ${errorMsg}`);
            }
          }
        }

        // update monitor
        await supabase.from("health_monitors").update({
          status: newStatus,
          last_checked_at: new Date().toISOString()
        }).eq("id", m.id);

        // insert event
        await supabase.from("health_events").insert({
          monitor_id: m.id,
          status: newStatus,
          response_time_ms: ms,
          error_message: errorMsg || null
        });
      }
    } catch (e) {
      console.error("Cron Error", e);
    }
  }, 5 * 60 * 1000); // 5 mins
}
