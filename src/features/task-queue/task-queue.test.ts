import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/db/test-database";
import {
  abandonTaskRun,
  acquireWorkerLock,
  cancelTaskRun,
  claimNextTask,
  enqueueScheduledTask,
  finishTaskRun,
  readTaskRun,
  renewTaskLease,
} from "./queue.ts";
import { resolveScheduledAt } from "./time.ts";
import { runWorker } from "./worker.ts";

const pastSchedule = {
  scheduledLocalAt: "2000-01-01T00:00",
  timeZone: "Asia/Tokyo",
};

function enqueue(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
  runType = "SUCCEED",
  timeoutMs = 5_000,
) {
  return enqueueScheduledTask(database, {
    idempotencyKey: randomUUID(),
    runType,
    input: { value: 1 },
    ...pastSchedule,
    timeoutMs,
  });
}

describe("task queue", () => {
  it("resolves unambiguous IANA local times and rejects DST gaps and folds", () => {
    expect(
      new Date(
        resolveScheduledAt("2026-07-01T09:00", "America/New_York"),
      ).toISOString(),
    ).toBe("2026-07-01T13:00:00.000Z");
    expect(() =>
      resolveScheduledAt("2026-03-08T02:30", "America/New_York"),
    ).toThrow("scheduled_local_time_does_not_exist");
    expect(() =>
      resolveScheduledAt("2026-11-01T01:30", "America/New_York"),
    ).toThrow("scheduled_local_time_is_ambiguous");
    expect(() => resolveScheduledAt("2026-07-01T09:00", "local")).toThrow(
      "scheduled_time_zone_invalid",
    );
  });

  it("deduplicates identical idempotency keys and rejects changed input", async () => {
    const fixture = await createTestDatabase();
    try {
      const idempotencyKey = randomUUID();
      const input = {
        idempotencyKey,
        runType: "SUCCEED",
        input: { z: 2, a: 1 },
        ...pastSchedule,
        timeoutMs: 5_000,
      };
      const first = enqueueScheduledTask(fixture.database, input);
      const replay = enqueueScheduledTask(fixture.database, {
        ...input,
        input: { a: 1, z: 2 },
      });
      expect(first.created).toBe(true);
      expect(replay.created).toBe(false);
      expect(replay.task.id).toBe(first.task.id);
      expect(() =>
        enqueueScheduledTask(fixture.database, {
          ...input,
          input: { a: 1, z: 3 },
        }),
      ).toThrow("idempotency_key_reused");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fences an expired claim and recovers it without running concurrent claims", async () => {
    const fixture = await createTestDatabase();
    try {
      const first = enqueue(fixture.database).task;
      const oldClaim = claimNextTask(
        fixture.database,
        "worker-old",
        Date.now(),
        100,
      );
      expect(oldClaim?.id).toBe(first.id);
      expect(
        claimNextTask(fixture.database, "worker-other", Date.now(), 100),
      ).toBeNull();

      const expiredAt = oldClaim!.leaseUntilMs!;
      expect(renewTaskLease(fixture.database, oldClaim!, expiredAt, 100)).toBe(
        false,
      );
      expect(abandonTaskRun(fixture.database, oldClaim!, expiredAt)).toBe(
        false,
      );
      expect(() =>
        finishTaskRun(
          fixture.database,
          oldClaim!,
          { executionStatus: "DONE", resultCode: "STALE" },
          expiredAt,
        ),
      ).toThrow("stale_worker_fence");

      const recovered = claimNextTask(
        fixture.database,
        "worker-new",
        expiredAt + 1,
        100,
      );
      expect(recovered?.attemptCount).toBe(2);
      expect(recovered?.fencingGeneration).toBe(
        oldClaim!.fencingGeneration + 1,
      );
      expect(() =>
        finishTaskRun(
          fixture.database,
          oldClaim!,
          { executionStatus: "DONE", resultCode: "STALE" },
          Date.now(),
        ),
      ).toThrow("stale_worker_fence");
    } finally {
      await fixture.cleanup();
    }
  });

  it("stops recovering a task after the three-attempt budget", async () => {
    const fixture = await createTestDatabase();
    try {
      let nowMs = 1_700_000_000_000;
      const task = enqueue(fixture.database).task;
      let claim = claimNextTask(fixture.database, "worker", nowMs, 10);
      expect(claim?.attemptCount).toBe(1);
      for (const attemptNo of [2, 3]) {
        nowMs = claim!.leaseUntilMs! + 1;
        claim = claimNextTask(fixture.database, "worker", nowMs, 10);
        expect(claim?.attemptCount).toBe(attemptNo);
      }

      expect(
        claimNextTask(fixture.database, "worker", claim!.leaseUntilMs! + 1, 10),
      ).toBeNull();
      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "FAILED",
        resultCode: "ATTEMPTS_EXHAUSTED",
        attemptCount: 3,
      });
      expect(
        fixture.database.client
          .prepare(
            "SELECT execution_status FROM task_run_attempts WHERE task_run_id = ? ORDER BY attempt_no",
          )
          .all(task.id),
      ).toEqual([
        { execution_status: "ABANDONED" },
        { execution_status: "ABANDONED" },
        { execution_status: "FAILED" },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("enforces a single worker lock and cancels pending work as SKIPPED", async () => {
    const fixture = await createTestDatabase();
    try {
      expect(acquireWorkerLock(fixture.database, "owner-a", 1, 100, 1000)).toBe(
        true,
      );
      expect(acquireWorkerLock(fixture.database, "owner-b", 2, 100, 1000)).toBe(
        false,
      );
      const task = enqueue(fixture.database).task;
      expect(cancelTaskRun(fixture.database, task.id)).toBe("CANCELLED");
      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "SKIPPED",
        resultCode: "CANCELLED",
        attemptCount: 0,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("runs a task in an isolated thread and persists its outcome", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database).task;
      const result = await runWorker(fixture.database, {
        maxTasks: 1,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
        handlersModuleUrl: new URL(
          "./test-handlers.fixture.ts",
          import.meta.url,
        ).href,
      });
      expect(result).toEqual({ acquired: true, processed: 1 });
      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "DONE",
        resultCode: "PROOF_COMPLETED",
        attemptCount: 1,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("invokes the scheduler hook when the worker has no due tasks", async () => {
    const fixture = await createTestDatabase();
    const controller = new AbortController();
    let idleCalls = 0;
    try {
      const result = await runWorker(fixture.database, {
        signal: controller.signal,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
        onIdle: () => {
          idleCalls += 1;
          controller.abort();
        },
      });

      expect(result).toEqual({ acquired: true, processed: 0 });
      expect(idleCalls).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails an invalid handler result without leaving the task running", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database, "INVALID_RESULT").task;
      await runWorker(fixture.database, {
        maxTasks: 1,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
        handlersModuleUrl: new URL(
          "./test-handlers.fixture.ts",
          import.meta.url,
        ).href,
      });
      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "FAILED",
        resultCode: "TASK_RESULT_CODE_INVALID",
        errorCode: "TASK_RESULT_CODE_INVALID",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects non-JSON handler evidence before persisting the outcome", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database, "INVALID_DETAILS").task;
      await runWorker(fixture.database, {
        maxTasks: 1,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
        handlersModuleUrl: new URL(
          "./test-handlers.fixture.ts",
          import.meta.url,
        ).href,
      });

      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "FAILED",
        resultCode: "TASK_RESULT_CODE_INVALID",
        errorCode: "TASK_RESULT_CODE_INVALID",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("times out and terminates an unresponsive task thread", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database, "SLOW", 150).task;
      await runWorker(fixture.database, {
        maxTasks: 1,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
        cancellationGraceMs: 10,
        handlersModuleUrl: new URL(
          "./test-handlers.fixture.ts",
          import.meta.url,
        ).href,
      });
      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "FAILED",
        resultCode: "TASK_TIMEOUT",
        errorCode: "TASK_TIMEOUT",
      });
      expect(
        fixture.database.client
          .prepare(
            "SELECT event_type FROM task_run_events WHERE task_run_id = ? ORDER BY occurred_at_ms DESC LIMIT 1",
          )
          .get(task.id),
      ).toEqual({ event_type: "TASK_TIMED_OUT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("cooperatively cancels a running task and does not report it as complete", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database, "SLOW", 5_000).task;
      const runner = runWorker(fixture.database, {
        maxTasks: 1,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
        cancellationGraceMs: 10,
        handlersModuleUrl: new URL(
          "./test-handlers.fixture.ts",
          import.meta.url,
        ).href,
      });
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (
          readTaskRun(fixture.database, task.id)?.executionStatus === "RUNNING"
        )
          break;
        await delay(10);
      }
      expect(cancelTaskRun(fixture.database, task.id)).toBe("REQUESTED");
      await runner;
      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: "SKIPPED",
        resultCode: "CANCELLED",
        attemptCount: 1,
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
