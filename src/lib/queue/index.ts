import { Queue } from "bullmq";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
  // Redis erişilemezken komutları süresiz kuyruklamak yerine anında hata ver;
  // aksi halde API istekleri (ör. iş oluşturma) sonsuza kadar askıda kalıyor.
  enableOfflineQueue: false,
  retryStrategy: (times: number) => Math.min(times * 1_000, 30_000),
};

export const migrationQueue = new Queue("migration-jobs", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: 100, // Keep last 100 failed jobs for debugging
  },
});

migrationQueue.on("error", error => {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(`[queue:migration-jobs] Redis bağlantı hatası${code ? ` (${code})` : ""}: ${error.message}`);
});

export type MigrationJobPayload = {
  jobId: string; // The UUID from job_runs table
  workspaceId: string;
  type: string;
  // Extracted job input (target URL, etc.) will be masked and handled
  inputs: Record<string, unknown>;
};
