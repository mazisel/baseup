import type { JobEvent, JobRun } from "@/types/domain";

declare global {
  var __supaOpsStore:
    | {
        jobs: Map<string, JobRun>;
        listeners: Map<string, Set<(event: JobEvent) => void>>;
      }
    | undefined;
}

export {};
