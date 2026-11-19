import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import type { AppDatabase } from "@/db";
import {
  abandonTaskRun,
  acquireWorkerLock,
  claimNextTask,
  finishTaskRun,
  recordWorkerLockLost,
  releaseWorkerLock,
  renewTaskLease,
  renewWorkerLock,
  taskCancellationRequested,
} from "./queue.ts";
import type { TaskRun, TaskRunOutcome } from "./types.ts";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 250;
const DEFAULT_LOCK_DURATION_MS = 15_000;
const DEFAULT_CANCELLATION_GRACE_MS = 100;

export type WorkerOptions = {
  signal?: AbortSignal;
  ownerId?: string;
  handlersModuleUrl?: string;
  heartbeatIntervalMs?: number;
  lockDurationMs?: number;
  cancellationGraceMs?: number;
  maxTasks?: number;
  onIdle?: (nowMs: number) => void;
};

async function stopRunner(runner: Worker, graceMs: number) {
  if (graceMs > 0) await delay(graceMs);
  await runner.terminate();
}

function runnerOutcome(value: unknown): TaskRunOutcome {
  if (typeof value !== "object" || value === null)
    return {
      executionStatus: "FAILED",
      resultCode: "WORKER_RESULT_INVALID",
      errorCode: "WORKER_RESULT_INVALID",
    };
  const result = value as Partial<TaskRunOutcome>;
  if (
    !["DONE", "FAILED", "BLOCKED_EXTERNAL", "SKIPPED"].includes(
      result.executionStatus ?? "",
    ) ||
    typeof result.resultCode !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.resultCode) ||
    (result.errorCode !== undefined &&
      (typeof result.errorCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.errorCode)))
  ) {
    return {
      executionStatus: "FAILED",
      resultCode: "WORKER_RESULT_INVALID",
      errorCode: "WORKER_RESULT_INVALID",
    };
  }
  return result as TaskRunOutcome;
}

async function executeTask(
  database: AppDatabase,
  task: TaskRun,
  ownerId: string,
  options: Required<
    Pick<
      WorkerOptions,
      | "handlersModuleUrl"
      | "heartbeatIntervalMs"
      | "lockDurationMs"
      | "cancellationGraceMs"
    >
  > & { signal?: AbortSignal },
) {
  let runner: Worker;
  try {
    runner = new Worker(new URL("./task-runner.ts", import.meta.url), {
      workerData: { task, handlersModuleUrl: options.handlersModuleUrl },
      execArgv: ["--experimental-strip-types"],
    });
  } catch {
    finishTaskRun(
      database,
      task,
      {
        executionStatus: "FAILED",
        resultCode: "WORKER_START_FAILED",
        errorCode: "WORKER_START_FAILED",
      },
      Date.now(),
    );
    return;
  }

  let outcome: TaskRunOutcome | undefined;
  let runnerError: unknown;
  let runnerExited = false;
  const startedAtMs = Date.now();
  runner.on("message", (message: unknown) => {
    if (!outcome) outcome = runnerOutcome(message);
  });
  runner.on("error", (error) => {
    runnerError = error;
  });
  runner.on("exit", () => {
    runnerExited = true;
  });

  try {
    while (!outcome && !runnerError && !runnerExited) {
      if (options.signal?.aborted) {
        await stopRunner(runner, 0);
        abandonTaskRun(database, task, Date.now());
        return;
      }

      const nowMs = Date.now();
      if (!renewWorkerLock(database, ownerId, nowMs, options.lockDurationMs)) {
        await stopRunner(runner, 0);
        abandonTaskRun(database, task, nowMs);
        recordWorkerLockLost(database, ownerId, nowMs, task.id);
        return;
      }
      if (!renewTaskLease(database, task, nowMs, options.lockDurationMs)) {
        await stopRunner(runner, 0);
        abandonTaskRun(database, task, nowMs);
        return;
      }

      if (taskCancellationRequested(database, task.id)) {
        runner.postMessage({ type: "ABORT" });
        await stopRunner(runner, options.cancellationGraceMs);
        finishTaskRun(
          database,
          task,
          {
            executionStatus: "SKIPPED",
            resultCode: "CANCELLED",
            errorCode: "CANCELLED",
          },
          Date.now(),
        );
        return;
      }

      if (nowMs - startedAtMs >= task.timeoutMs) {
        runner.postMessage({ type: "ABORT" });
        await stopRunner(runner, options.cancellationGraceMs);
        finishTaskRun(
          database,
          task,
          {
            executionStatus: "FAILED",
            resultCode: "TASK_TIMEOUT",
            errorCode: "TASK_TIMEOUT",
          },
          Date.now(),
        );
        return;
      }

      const remainingMs = task.timeoutMs - (nowMs - startedAtMs);
      await delay(Math.min(options.heartbeatIntervalMs, remainingMs));
    }
  } finally {
    if (!runnerExited) await runner.terminate();
  }

  if (outcome) {
    finishTaskRun(database, task, outcome, Date.now());
    return;
  }
  finishTaskRun(
    database,
    task,
    {
      executionStatus: "FAILED",
      resultCode: "TASK_RUNNER_FAILED",
      errorCode:
        runnerError instanceof Error &&
        /^[A-Z][A-Z0-9_]{0,63}$/.test(runnerError.message)
          ? runnerError.message
          : "TASK_RUNNER_FAILED",
    },
    Date.now(),
  );
}

export async function runWorker(
  database: AppDatabase,
  options: WorkerOptions = {},
) {
  const ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const lockDurationMs = options.lockDurationMs ?? DEFAULT_LOCK_DURATION_MS;
  const cancellationGraceMs =
    options.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS;
  const handlersModuleUrl =
    options.handlersModuleUrl ?? new URL("./handlers.ts", import.meta.url).href;
  if (
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 10 ||
    !Number.isSafeInteger(lockDurationMs) ||
    lockDurationMs <= heartbeatIntervalMs ||
    (options.maxTasks !== undefined &&
      (!Number.isSafeInteger(options.maxTasks) || options.maxTasks < 1))
  ) {
    throw new Error("worker_options_invalid");
  }

  const acquired = acquireWorkerLock(
    database,
    ownerId,
    process.pid,
    Date.now(),
    lockDurationMs,
  );
  if (!acquired) return { acquired: false, processed: 0 };

  let processed = 0;
  try {
    while (!options.signal?.aborted) {
      const nowMs = Date.now();
      if (!renewWorkerLock(database, ownerId, nowMs, lockDurationMs)) {
        recordWorkerLockLost(database, ownerId, nowMs);
        throw new Error("worker_lock_lost");
      }
      const task = claimNextTask(database, ownerId, nowMs, lockDurationMs);
      if (task) {
        processed += 1;
        await executeTask(database, task, ownerId, {
          handlersModuleUrl,
          heartbeatIntervalMs,
          lockDurationMs,
          cancellationGraceMs,
          signal: options.signal,
        });
        if (options.maxTasks !== undefined && processed >= options.maxTasks)
          break;
        continue;
      }
      options.onIdle?.(nowMs);
      if (options.maxTasks !== undefined) break;
      await delay(heartbeatIntervalMs, undefined, {
        signal: options.signal,
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "AbortError")
          throw error;
      });
    }
    return { acquired: true, processed };
  } finally {
    releaseWorkerLock(database, ownerId, Date.now());
  }
}
