import { openDatabase, getLocalDatabasePath } from "../src/db/index.ts";
import { cancelTaskRun } from "../src/features/task-queue/queue.ts";
import { runWorker } from "../src/features/task-queue/worker.ts";
import { enqueueScheduledReportJobs } from "../src/features/reports/jobs.ts";

const [command, taskRunId] = process.argv.slice(2);
const database = await openDatabase(getLocalDatabasePath());

try {
  if (command === "cancel" && taskRunId) {
    const outcome = cancelTaskRun(database, taskRunId);
    process.stdout.write(
      JSON.stringify({ event: "task_cancel", taskRunId, outcome }) + "\n",
    );
    if (outcome === "NOT_FOUND") process.exitCode = 1;
  } else if (command === undefined) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.stdout.write(
      JSON.stringify({ event: "worker_starting", pid: process.pid }) + "\n",
    );
    let lastScheduleCheckMinute = -1;
    const result = await runWorker(database, {
      signal: controller.signal,
      onIdle: (nowMs) => {
        const minute = Math.floor(nowMs / 60_000);
        if (minute === lastScheduleCheckMinute) return;
        lastScheduleCheckMinute = minute;
        enqueueScheduledReportJobs(database, nowMs);
      },
    });
    process.stdout.write(
      JSON.stringify({
        event: result.acquired ? "worker_stopped" : "worker_already_running",
        ...result,
      }) + "\n",
    );
  } else {
    process.stderr.write("usage: pnpm worker [cancel <taskRunId>]\n");
    process.exitCode = 2;
  }
} finally {
  database.client.close();
}
