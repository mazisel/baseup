export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const workerGlobal = globalThis as typeof globalThis & { __worker_started?: boolean };
    if (!workerGlobal.__worker_started) {
      const { startWorker, startCronJobs } = await import("./lib/queue/worker");
      startWorker();
      startCronJobs();
      workerGlobal.__worker_started = true;
      console.log("BullMQ Worker & Cron Jobs started in Node.js runtime");
    }
  }
}
