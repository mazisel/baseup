import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null,
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

export type MigrationJobPayload = {
  jobId: string; // The UUID from job_runs table
  workspaceId: string;
  type: string;
  // Extracted job input (target URL, etc.) will be masked and handled
  inputs: Record<string, any>;
};

export const cronQueue = new Queue("cron-jobs", {
  connection,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: true }
});
