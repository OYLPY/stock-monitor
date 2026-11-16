import { setTimeout as delay } from "node:timers/promises";
import {
  claimNextTask,
  commitEffect,
  completeTask,
  openStore,
  recordRuntimeTick,
} from "./store.ts";

function emit(event: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function hold() {
  setInterval(() => {}, 60_000);
  return new Promise<never>(() => {});
}

function runOnce(
  databasePath: string,
  nowMs: number,
  leaseDurationMs: number,
  pauseAt: string,
) {
  const database = openStore(databasePath);
  if (pauseAt === "before_claim") {
    emit({ event: "ready_before_claim", pid: process.pid });
    return hold();
  }

  const task = claimNextTask(
    database,
    "worker-" + process.pid,
    nowMs,
    leaseDurationMs,
  );
  if (!task) {
    emit({ event: "idle", pid: process.pid });
    database.close();
    return;
  }

  emit({
    event: "claim_committed",
    taskId: task.id,
    claimGeneration: task.claim_generation,
  });
  if (pauseAt === "after_claim") return hold();

  const effectCreated = commitEffect(database, task, nowMs + 1);
  emit({
    event: "effect_committed",
    taskId: task.id,
    effectCreated,
  });
  if (pauseAt === "after_effect_commit") return hold();

  completeTask(database, task, nowMs + 2);
  emit({ event: "done_committed", taskId: task.id });
  if (pauseAt === "after_final_commit") return hold();

  database.close();
}

async function runLoop(databasePath: string) {
  const database = openStore(databasePath);
  let lastHeartbeatAt = Date.now();
  recordRuntimeTick(database, lastHeartbeatAt);
  emit({ event: "worker_ready", pid: process.pid });

  while (true) {
    const nowMs = Date.now();
    if (nowMs - lastHeartbeatAt >= 1_000) {
      recordRuntimeTick(database, nowMs);
      lastHeartbeatAt = nowMs;
    }

    const task = claimNextTask(database, "worker-" + process.pid, nowMs, 5_000);
    if (!task) {
      await delay(100);
      continue;
    }

    emit({ event: "claim_committed", taskId: task.id });
    await delay(250);
    commitEffect(database, task, Date.now());
    completeTask(database, task, Date.now());
    emit({ event: "done_committed", taskId: task.id });
  }
}

const [mode, databasePath, nowText, leaseText, pauseAt] = process.argv.slice(2);

if (mode === "once" && databasePath && nowText && leaseText) {
  try {
    runOnce(databasePath, Number(nowText), Number(leaseText), pauseAt ?? "");
  } catch (error) {
    emit({
      event: "worker_failed",
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    process.exitCode = 1;
  }
} else if (mode === "loop" && databasePath) {
  runLoop(databasePath).catch((error: unknown) => {
    emit({
      event: "worker_failed",
      reason: error instanceof Error ? error.message : "unknown_error",
    });
    process.exitCode = 1;
  });
} else {
  emit({ event: "invalid_worker_arguments" });
  process.exitCode = 2;
}
