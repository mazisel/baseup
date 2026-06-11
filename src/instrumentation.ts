export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker, startCronJobs } = await import("./lib/queue/worker");
    startWorker();
    startCronJobs();
    console.log("BullMQ Worker & Cron Jobs started in Node.js runtime");
  }
}
