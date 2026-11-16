import { createHash, randomUUID } from "node:crypto";
import type { AppDatabase } from "@/db";
import { resolveScheduledAt } from "./time.ts";
import type {
  JsonValue,
  TaskRun,
  TaskRunOutcome,
  TaskRunStatus,
} from "./types.ts";

const MAX_ATTEMPTS = 3;

type TaskRunRow = {
  id: string;
  idempotency_key: string;
  input_hash_sha256: string;
  run_type: string;
  input_json: string;
  time_zone: string;
  scheduled_local_at: string;
  scheduled_at_ms: bigint | number;
  timeout_ms: bigint | number;
  execution_status: TaskRunStatus;
  attempt_count: bigint | number;
  next_attempt_at_ms: bigint | number;
  lease_owner: string | null;
  lease_until_ms: bigint | number | null;
  fencing_generation: bigint | number;
  cancellation_requested_at_ms: bigint | number | null;
  result_code: string | null;
  error_code: string | null;
  created_at_ms: bigint | number;
  started_at_ms: bigint | number | null;
  finished_at_ms: bigint | number | null;
};

export type ScheduledTaskInput = {
  idempotencyKey: string;
  runType: string;
  input: JsonValue;
  timeZone: string;
  scheduledLocalAt: string;
  timeoutMs: number;
  createdAtMs?: number;
};

function safeNumber(value: bigint | number | null) {
  if (value === null) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error("task_timestamp_out_of_range");
  return result;
}

function mapTaskRun(row: TaskRunRow): TaskRun {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    inputHashSha256: row.input_hash_sha256,
    runType: row.run_type,
    inputJson: row.input_json,
    timeZone: row.time_zone,
    scheduledLocalAt: row.scheduled_local_at,
    scheduledAtMs: safeNumber(row.scheduled_at_ms)!,
    timeoutMs: safeNumber(row.timeout_ms)!,
    executionStatus: row.execution_status,
    attemptCount: safeNumber(row.attempt_count)!,
    nextAttemptAtMs: safeNumber(row.next_attempt_at_ms)!,
    leaseOwner: row.lease_owner,
    leaseUntilMs: safeNumber(row.lease_until_ms),
    fencingGeneration: safeNumber(row.fencing_generation)!,
    cancellationRequestedAtMs: safeNumber(row.cancellation_requested_at_ms),
    resultCode: row.result_code,
    errorCode: row.error_code,
    createdAtMs: safeNumber(row.created_at_ms)!,
    startedAtMs: safeNumber(row.started_at_ms),
    finishedAtMs: safeNumber(row.finished_at_ms),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("task_input_not_json");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error("task_input_not_json");
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("task_input_not_json");
}

function assertSafeTimestamp(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

function appendEvent(
  database: AppDatabase,
  input: {
    taskRunId: string | null;
    workerId: string | null;
    eventType: string;
    occurredAtMs: number;
    details?: JsonValue;
  },
) {
  database.client
    .prepare(
      `INSERT INTO task_run_events
        (id, task_run_id, worker_id, event_type, occurred_at_ms, details_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.taskRunId,
      input.workerId,
      input.eventType,
      BigInt(input.occurredAtMs),
      canonicalJson(input.details ?? {}),
    );
}

export function readTaskRun(database: AppDatabase, id: string) {
  const row = database.client
    .prepare("SELECT * FROM task_runs WHERE id = ?")
    .get(id) as TaskRunRow | undefined;
  return row ? mapTaskRun(row) : null;
}

export function enqueueScheduledTask(
  database: AppDatabase,
  input: ScheduledTaskInput,
) {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.runType))
    throw new Error("task_run_type_invalid");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey))
    throw new Error("task_idempotency_key_invalid");
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 86_400_000
  )
    throw new Error("task_timeout_invalid");

  const scheduledLocalAt =
    input.scheduledLocalAt.length === 16
      ? `${input.scheduledLocalAt}:00`
      : input.scheduledLocalAt;
  const scheduledAtMs = resolveScheduledAt(scheduledLocalAt, input.timeZone);
  const inputJson = canonicalJson(input.input);
  const inputHashSha256 = createHash("sha256")
    .update(
      canonicalJson({
        input: JSON.parse(inputJson),
        runType: input.runType,
        scheduledLocalAt,
        timeZone: input.timeZone,
        timeoutMs: input.timeoutMs,
      }),
    )
    .digest("hex");
  const createdAtMs = input.createdAtMs ?? Date.now();
  assertSafeTimestamp(createdAtMs, "task_created_at_invalid");
  const id = randomUUID();

  const create = database.client.transaction(() => {
    const inserted = database.client
      .prepare(
        `INSERT OR IGNORE INTO task_runs
          (id, idempotency_key, input_hash_sha256, run_type, input_json,
           time_zone, scheduled_local_at, scheduled_at_ms, timeout_ms,
           execution_status, attempt_count, next_attempt_at_ms,
           fencing_generation, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, 0, ?)`,
      )
      .run(
        id,
        input.idempotencyKey,
        inputHashSha256,
        input.runType,
        inputJson,
        input.timeZone,
        scheduledLocalAt,
        BigInt(scheduledAtMs),
        input.timeoutMs,
        BigInt(scheduledAtMs),
        BigInt(createdAtMs),
      );
    const row = database.client
      .prepare("SELECT * FROM task_runs WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as TaskRunRow | undefined;
    if (!row) throw new Error("task_insert_missing");
    if (row.input_hash_sha256 !== inputHashSha256)
      throw new Error("idempotency_key_reused");
    const task = mapTaskRun(row);
    if (inserted.changes === 1) {
      appendEvent(database, {
        taskRunId: task.id,
        workerId: null,
        eventType: "TASK_QUEUED",
        occurredAtMs: createdAtMs,
        details: {
          runType: task.runType,
          scheduledAtMs: task.scheduledAtMs,
          timeZone: task.timeZone,
        },
      });
    }
    return { task, created: inserted.changes === 1 };
  });

  return create.immediate();
}

export function cancelTaskRun(
  database: AppDatabase,
  taskRunId: string,
  nowMs = Date.now(),
) {
  assertSafeTimestamp(nowMs, "task_cancel_at_invalid");
  const cancel = database.client.transaction(() => {
    const task = readTaskRun(database, taskRunId);
    if (!task) return "NOT_FOUND" as const;
    if (
      task.executionStatus !== "PENDING" &&
      task.executionStatus !== "RUNNING"
    )
      return "ALREADY_FINISHED" as const;
    if (task.cancellationRequestedAtMs !== null)
      return "ALREADY_REQUESTED" as const;

    if (
      task.executionStatus === "PENDING" ||
      (task.leaseUntilMs !== null && task.leaseUntilMs <= nowMs)
    ) {
      const taskUpdate = database.client
        .prepare(
          `UPDATE task_runs
           SET execution_status = 'SKIPPED', result_code = 'CANCELLED',
               cancellation_requested_at_ms = ?, lease_owner = NULL,
               lease_until_ms = NULL, fencing_generation = fencing_generation + 1,
               finished_at_ms = ?
           WHERE id = ? AND execution_status IN ('PENDING', 'RUNNING')`,
        )
        .run(BigInt(nowMs), BigInt(nowMs), taskRunId);
      if (taskUpdate.changes !== 1) throw new Error("stale_worker_fence");
      const attemptUpdate = database.client
        .prepare(
          `UPDATE task_run_attempts
           SET execution_status = 'SKIPPED', finished_at_ms = ?, error_code = 'CANCELLED'
           WHERE task_run_id = ? AND execution_status = 'RUNNING'`,
        )
        .run(BigInt(nowMs), taskRunId);
      if (task.executionStatus === "RUNNING" && attemptUpdate.changes !== 1) {
        throw new Error("task_attempt_missing");
      }
      appendEvent(database, {
        taskRunId,
        workerId: task.leaseOwner,
        eventType: "TASK_CANCELLED",
        occurredAtMs: nowMs,
        details: { resultCode: "CANCELLED" },
      });
      return "CANCELLED" as const;
    }

    database.client
      .prepare(
        `UPDATE task_runs SET cancellation_requested_at_ms = ?
         WHERE id = ? AND execution_status = 'RUNNING'
           AND cancellation_requested_at_ms IS NULL`,
      )
      .run(BigInt(nowMs), taskRunId);
    appendEvent(database, {
      taskRunId,
      workerId: task.leaseOwner,
      eventType: "TASK_CANCEL_REQUESTED",
      occurredAtMs: nowMs,
      details: {},
    });
    return "REQUESTED" as const;
  });
  return cancel.immediate();
}

export function claimNextTask(
  database: AppDatabase,
  workerId: string,
  nowMs: number,
  leaseDurationMs: number,
) {
  assertSafeTimestamp(nowMs, "task_claim_at_invalid");
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1)
    throw new Error("task_lease_duration_invalid");

  const claim = database.client.transaction(() => {
    const expiredRows = database.client
      .prepare(
        `SELECT * FROM task_runs
         WHERE execution_status = 'RUNNING' AND lease_until_ms <= ?`,
      )
      .all(BigInt(nowMs)) as TaskRunRow[];

    for (const expiredRow of expiredRows) {
      const expired = mapTaskRun(expiredRow);
      const cancelled = expired.cancellationRequestedAtMs !== null;
      const exhausted = expired.attemptCount >= MAX_ATTEMPTS;
      if (!cancelled && !exhausted) continue;
      const status = cancelled ? "SKIPPED" : "FAILED";
      const resultCode = cancelled ? "CANCELLED" : "ATTEMPTS_EXHAUSTED";
      const errorCode = cancelled ? "CANCELLED" : "WORKER_LEASE_EXPIRED";
      const taskUpdate = database.client
        .prepare(
          `UPDATE task_runs SET execution_status = ?, result_code = ?, error_code = ?,
              lease_owner = NULL, lease_until_ms = NULL,
              fencing_generation = fencing_generation + 1, finished_at_ms = ?
           WHERE id = ? AND execution_status = 'RUNNING' AND lease_until_ms <= ?`,
        )
        .run(
          status,
          resultCode,
          errorCode,
          BigInt(nowMs),
          expired.id,
          BigInt(nowMs),
        );
      if (taskUpdate.changes !== 1) throw new Error("stale_worker_fence");
      const attemptUpdate = database.client
        .prepare(
          `UPDATE task_run_attempts SET execution_status = ?, finished_at_ms = ?, error_code = ?
           WHERE task_run_id = ? AND execution_status = 'RUNNING'`,
        )
        .run(
          cancelled ? "SKIPPED" : "FAILED",
          BigInt(nowMs),
          errorCode,
          expired.id,
        );
      if (attemptUpdate.changes !== 1) throw new Error("task_attempt_missing");
      appendEvent(database, {
        taskRunId: expired.id,
        workerId: expired.leaseOwner,
        eventType: cancelled ? "TASK_CANCELLED" : "TASK_FAILED",
        occurredAtMs: nowMs,
        details: { resultCode, errorCode },
      });
    }

    const row = database.client
      .prepare(
        `SELECT * FROM task_runs
         WHERE (execution_status = 'PENDING' AND next_attempt_at_ms <= ?)
            OR (execution_status = 'RUNNING' AND lease_until_ms <= ?)
         ORDER BY next_attempt_at_ms, created_at_ms, id
         LIMIT 1`,
      )
      .get(BigInt(nowMs), BigInt(nowMs)) as TaskRunRow | undefined;
    if (!row) return null;

    const previous = mapTaskRun(row);
    const attemptNo = previous.attemptCount + 1;
    const claimGeneration = previous.fencingGeneration + 1;
    const eventType =
      previous.executionStatus === "RUNNING"
        ? "TASK_RECLAIMED"
        : "TASK_CLAIMED";
    if (previous.executionStatus === "RUNNING") {
      const attemptUpdate = database.client
        .prepare(
          `UPDATE task_run_attempts SET execution_status = 'ABANDONED',
             finished_at_ms = ?, error_code = 'WORKER_LEASE_EXPIRED'
           WHERE task_run_id = ? AND execution_status = 'RUNNING'`,
        )
        .run(BigInt(nowMs), previous.id);
      if (attemptUpdate.changes !== 1) throw new Error("task_attempt_missing");
    }
    const taskUpdate = database.client
      .prepare(
        `UPDATE task_runs SET execution_status = 'RUNNING', attempt_count = ?,
            lease_owner = ?, lease_until_ms = ?, fencing_generation = ?,
            started_at_ms = COALESCE(started_at_ms, ?), finished_at_ms = NULL,
            result_code = NULL, error_code = NULL
         WHERE id = ?`,
      )
      .run(
        attemptNo,
        workerId,
        BigInt(nowMs + leaseDurationMs),
        claimGeneration,
        BigInt(nowMs),
        previous.id,
      );
    if (taskUpdate.changes !== 1) throw new Error("task_claim_failed");
    database.client
      .prepare(
        `INSERT INTO task_run_attempts
          (task_run_id, attempt_no, worker_id, execution_status, started_at_ms)
         VALUES (?, ?, ?, 'RUNNING', ?)`,
      )
      .run(previous.id, attemptNo, workerId, BigInt(nowMs));
    appendEvent(database, {
      taskRunId: previous.id,
      workerId,
      eventType,
      occurredAtMs: nowMs,
      details: { attemptNo, claimGeneration },
    });
    return readTaskRun(database, previous.id);
  });

  return claim.immediate();
}

export function renewTaskLease(
  database: AppDatabase,
  task: TaskRun,
  nowMs: number,
  leaseDurationMs: number,
) {
  const result = database.client
    .prepare(
      `UPDATE task_runs SET lease_until_ms = ?
       WHERE id = ? AND execution_status = 'RUNNING' AND lease_owner = ?
         AND fencing_generation = ? AND lease_until_ms > ?`,
    )
    .run(
      BigInt(nowMs + leaseDurationMs),
      task.id,
      task.leaseOwner,
      task.fencingGeneration,
      BigInt(nowMs),
    );
  return result.changes === 1;
}

export function taskCancellationRequested(
  database: AppDatabase,
  taskId: string,
) {
  const row = database.client
    .prepare(
      `SELECT cancellation_requested_at_ms FROM task_runs
       WHERE id = ? AND execution_status = 'RUNNING'`,
    )
    .get(taskId) as
    { cancellation_requested_at_ms: bigint | number | null } | undefined;
  return row?.cancellation_requested_at_ms != null;
}

export function finishTaskRun(
  database: AppDatabase,
  task: TaskRun,
  outcome: TaskRunOutcome,
  nowMs: number,
) {
  assertSafeTimestamp(nowMs, "task_finish_at_invalid");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.resultCode))
    throw new Error("task_result_code_invalid");
  if (outcome.errorCode && !/^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.errorCode))
    throw new Error("task_error_code_invalid");

  const finish = database.client.transaction(() => {
    const current = readTaskRun(database, task.id);
    if (
      !current ||
      current.executionStatus !== "RUNNING" ||
      current.leaseOwner !== task.leaseOwner ||
      current.fencingGeneration !== task.fencingGeneration ||
      current.leaseUntilMs === null ||
      current.leaseUntilMs <= nowMs
    ) {
      throw new Error("stale_worker_fence");
    }

    const cancelled = current.cancellationRequestedAtMs !== null;
    const executionStatus = cancelled ? "SKIPPED" : outcome.executionStatus;
    const resultCode = cancelled ? "CANCELLED" : outcome.resultCode;
    const errorCode = cancelled ? "CANCELLED" : (outcome.errorCode ?? null);
    const update = database.client
      .prepare(
        `UPDATE task_runs SET execution_status = ?, result_code = ?, error_code = ?,
            lease_owner = NULL, lease_until_ms = NULL, finished_at_ms = ?
         WHERE id = ? AND execution_status = 'RUNNING' AND lease_owner = ?
            AND fencing_generation = ? AND lease_until_ms > ?`,
      )
      .run(
        executionStatus,
        resultCode,
        errorCode,
        BigInt(nowMs),
        task.id,
        task.leaseOwner,
        task.fencingGeneration,
        BigInt(nowMs),
      );
    if (update.changes !== 1) throw new Error("stale_worker_fence");
    const attemptUpdate = database.client
      .prepare(
        `UPDATE task_run_attempts SET execution_status = ?, finished_at_ms = ?, error_code = ?
         WHERE task_run_id = ? AND attempt_no = ? AND execution_status = 'RUNNING'`,
      )
      .run(
        executionStatus,
        BigInt(nowMs),
        errorCode,
        task.id,
        task.attemptCount,
      );
    if (attemptUpdate.changes !== 1) throw new Error("task_attempt_missing");
    const eventType = cancelled
      ? "TASK_CANCELLED"
      : resultCode === "TASK_TIMEOUT"
        ? "TASK_TIMED_OUT"
        : executionStatus === "DONE"
          ? "TASK_COMPLETED"
          : executionStatus === "BLOCKED_EXTERNAL"
            ? "TASK_BLOCKED_EXTERNAL"
            : executionStatus === "SKIPPED"
              ? "TASK_SKIPPED"
              : "TASK_FAILED";
    appendEvent(database, {
      taskRunId: task.id,
      workerId: task.leaseOwner,
      eventType,
      occurredAtMs: nowMs,
      details: {
        resultCode,
        errorCode,
        ...(outcome.details === undefined ? {} : { handler: outcome.details }),
      },
    });
    return readTaskRun(database, task.id)!;
  });
  return finish.immediate();
}

export function abandonTaskRun(
  database: AppDatabase,
  task: TaskRun,
  nowMs: number,
) {
  assertSafeTimestamp(nowMs, "task_abandon_at_invalid");
  const abandon = database.client.transaction(() => {
    const exhausted = task.attemptCount >= MAX_ATTEMPTS;
    const update = database.client
      .prepare(
        `UPDATE task_runs SET execution_status = ?, next_attempt_at_ms = ?,
            result_code = ?, error_code = ?, lease_owner = NULL, lease_until_ms = NULL,
            finished_at_ms = ?,
            fencing_generation = fencing_generation + 1
         WHERE id = ? AND execution_status = 'RUNNING' AND lease_owner = ?
            AND fencing_generation = ? AND lease_until_ms > ?`,
      )
      .run(
        exhausted ? "FAILED" : "PENDING",
        BigInt(nowMs),
        exhausted ? "ATTEMPTS_EXHAUSTED" : null,
        exhausted ? "WORKER_STOPPED" : null,
        exhausted ? BigInt(nowMs) : null,
        task.id,
        task.leaseOwner,
        task.fencingGeneration,
        BigInt(nowMs),
      );
    if (update.changes !== 1) return false;
    const attemptUpdate = database.client
      .prepare(
        `UPDATE task_run_attempts SET execution_status = 'ABANDONED',
            finished_at_ms = ?, error_code = 'WORKER_STOPPED'
         WHERE task_run_id = ? AND attempt_no = ? AND execution_status = 'RUNNING'`,
      )
      .run(BigInt(nowMs), task.id, task.attemptCount);
    if (attemptUpdate.changes !== 1) throw new Error("task_attempt_missing");
    appendEvent(database, {
      taskRunId: task.id,
      workerId: task.leaseOwner,
      eventType: exhausted ? "TASK_FAILED" : "TASK_ABANDONED",
      occurredAtMs: nowMs,
      details: {
        reason: "WORKER_STOPPED",
        ...(exhausted ? { resultCode: "ATTEMPTS_EXHAUSTED" } : {}),
      },
    });
    return true;
  });
  return abandon.immediate();
}

export function acquireWorkerLock(
  database: AppDatabase,
  ownerId: string,
  processId: number,
  nowMs: number,
  leaseDurationMs: number,
) {
  const acquire = database.client.transaction(() => {
    database.client
      .prepare("INSERT OR IGNORE INTO worker_state (singleton_id) VALUES (1)")
      .run();
    const result = database.client
      .prepare(
        `UPDATE worker_state SET owner_id = ?, process_id = ?, acquired_at_ms = ?,
            heartbeat_at_ms = ?, lease_until_ms = ?
         WHERE singleton_id = 1 AND (owner_id IS NULL OR lease_until_ms <= ?)`,
      )
      .run(
        ownerId,
        processId,
        BigInt(nowMs),
        BigInt(nowMs),
        BigInt(nowMs + leaseDurationMs),
        BigInt(nowMs),
      );
    if (result.changes === 1) {
      appendEvent(database, {
        taskRunId: null,
        workerId: ownerId,
        eventType: "WORKER_LOCK_ACQUIRED",
        occurredAtMs: nowMs,
        details: { processId },
      });
      return true;
    }
    return false;
  });
  return acquire.immediate();
}

export function renewWorkerLock(
  database: AppDatabase,
  ownerId: string,
  nowMs: number,
  leaseDurationMs: number,
) {
  const result = database.client
    .prepare(
      `UPDATE worker_state SET heartbeat_at_ms = ?, lease_until_ms = ?
       WHERE singleton_id = 1 AND owner_id = ? AND lease_until_ms > ?`,
    )
    .run(
      BigInt(nowMs),
      BigInt(nowMs + leaseDurationMs),
      ownerId,
      BigInt(nowMs),
    );
  return result.changes === 1;
}

export function releaseWorkerLock(
  database: AppDatabase,
  ownerId: string,
  nowMs: number,
) {
  const release = database.client.transaction(() => {
    const result = database.client
      .prepare(
        `UPDATE worker_state SET owner_id = NULL, process_id = NULL,
            acquired_at_ms = NULL, heartbeat_at_ms = NULL, lease_until_ms = NULL
         WHERE singleton_id = 1 AND owner_id = ?`,
      )
      .run(ownerId);
    if (result.changes === 1) {
      appendEvent(database, {
        taskRunId: null,
        workerId: ownerId,
        eventType: "WORKER_LOCK_RELEASED",
        occurredAtMs: nowMs,
        details: {},
      });
    }
    return result.changes === 1;
  });
  return release.immediate();
}

export function recordWorkerLockLost(
  database: AppDatabase,
  ownerId: string,
  nowMs: number,
  taskRunId: string | null = null,
) {
  const record = database.client.transaction(() => {
    appendEvent(database, {
      taskRunId,
      workerId: ownerId,
      eventType: "WORKER_LOCK_LOST",
      occurredAtMs: nowMs,
      details: {},
    });
  });
  record.immediate();
}
