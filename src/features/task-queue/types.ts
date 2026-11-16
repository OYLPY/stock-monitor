export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type TaskRunStatus =
  "PENDING" | "RUNNING" | "DONE" | "FAILED" | "BLOCKED_EXTERNAL" | "SKIPPED";

export type TaskRunOutcome = {
  executionStatus: Exclude<TaskRunStatus, "PENDING" | "RUNNING">;
  resultCode: string;
  errorCode?: string;
  details?: JsonValue;
};

export type TaskRun = {
  id: string;
  idempotencyKey: string;
  inputHashSha256: string;
  runType: string;
  inputJson: string;
  timeZone: string;
  scheduledLocalAt: string;
  scheduledAtMs: number;
  timeoutMs: number;
  executionStatus: TaskRunStatus;
  attemptCount: number;
  nextAttemptAtMs: number;
  leaseOwner: string | null;
  leaseUntilMs: number | null;
  fencingGeneration: number;
  cancellationRequestedAtMs: number | null;
  resultCode: string | null;
  errorCode: string | null;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
};

export type TaskHandlerContext = {
  taskRunId: string;
  idempotencyKey: string;
  attemptNo: number;
  input: JsonValue;
  runType: string;
  timeZone: string;
  scheduledLocalAt: string;
  scheduledAtMs: number;
  signal: AbortSignal;
};

export type TaskHandlerResult = {
  executionStatus?: "DONE" | "BLOCKED_EXTERNAL" | "SKIPPED";
  resultCode: string;
  errorCode?: string;
  details?: JsonValue;
};

export type TaskHandler = (
  context: TaskHandlerContext,
) => Promise<TaskHandlerResult>;

export type TaskHandlerRegistry = Record<string, TaskHandler>;
