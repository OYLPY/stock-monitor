import { parentPort, workerData } from "node:worker_threads";
import type { TaskHandlerRegistry, TaskRunOutcome } from "./types.ts";

type RunnerData = {
  task: {
    id: string;
    idempotencyKey: string;
    attemptCount: number;
    runType: string;
    inputJson: string;
    timeZone: string;
    scheduledLocalAt: string;
    scheduledAtMs: number;
  };
  handlersModuleUrl: string;
};

const runner = parentPort;
const data = workerData as RunnerData;
const controller = new AbortController();
runner?.on("message", (message: { type?: string }) => {
  if (message?.type === "ABORT") controller.abort();
});

function errorOutcome(error: unknown): TaskRunOutcome {
  const value = error as { code?: unknown; executionStatus?: unknown };
  const errorCode =
    typeof value?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
      ? value.code
      : "TASK_HANDLER_FAILED";
  const executionStatus =
    value?.executionStatus === "BLOCKED_EXTERNAL" ||
    value?.executionStatus === "SKIPPED"
      ? value.executionStatus
      : "FAILED";
  return { executionStatus, resultCode: errorCode, errorCode };
}

try {
  const handlersModule = (await import(data.handlersModuleUrl)) as {
    taskHandlers: TaskHandlerRegistry;
  };
  const handler = handlersModule.taskHandlers[data.task.runType];
  if (!handler) {
    runner?.postMessage({
      executionStatus: "FAILED",
      resultCode: "HANDLER_NOT_REGISTERED",
      errorCode: "HANDLER_NOT_REGISTERED",
    } satisfies TaskRunOutcome);
  } else {
    const result = await handler({
      taskRunId: data.task.id,
      idempotencyKey: data.task.idempotencyKey,
      attemptNo: data.task.attemptCount,
      input: JSON.parse(data.task.inputJson),
      runType: data.task.runType,
      timeZone: data.task.timeZone,
      scheduledLocalAt: data.task.scheduledLocalAt,
      scheduledAtMs: data.task.scheduledAtMs,
      signal: controller.signal,
    });
    if (
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.resultCode) ||
      (result.errorCode !== undefined &&
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(result.errorCode)) ||
      ![undefined, "DONE", "BLOCKED_EXTERNAL", "SKIPPED"].includes(
        result.executionStatus,
      )
    ) {
      throw Object.assign(new Error("task_result_code_invalid"), {
        code: "TASK_RESULT_CODE_INVALID",
      });
    }
    runner?.postMessage({
      executionStatus: result.executionStatus ?? "DONE",
      resultCode: result.resultCode,
      errorCode: result.errorCode,
    } satisfies TaskRunOutcome);
  }
} catch (error) {
  runner?.postMessage(errorOutcome(error));
}
