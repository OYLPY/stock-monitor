import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { enqueueScheduledTask, readTaskRun } from "@/features/task-queue/queue";
import { POST } from "@/app/api/v1/tasks/[id]/cancel/route";

const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let testDataDirectory = "";

function localRequest(origin = "http://127.0.0.1") {
  return new Request("http://127.0.0.1/api/v1/tasks/task-id/cancel", {
    method: "POST",
    headers: { host: "127.0.0.1", origin },
  });
}

async function enqueuePendingTask() {
  const database = await openDatabase(getLocalDatabasePath());
  try {
    return enqueueScheduledTask(database, {
      idempotencyKey: "task-cancel-test",
      runType: "RESEARCH_REPORT",
      input: { type: "MORNING" },
      timeZone: "Asia/Tokyo",
      scheduledLocalAt: "2000-01-01T00:00",
      timeoutMs: 5_000,
    }).task;
  } finally {
    database.client.close();
  }
}

describe("task cancellation route", () => {
  beforeEach(async () => {
    testDataDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-task-"));
    process.env.STOCK_MONITOR_DATA_DIR = testDataDirectory;
  });

  afterEach(async () => {
    await rm(testDataDirectory, { recursive: true, force: true });
    if (originalDataDirectory === undefined) {
      delete process.env.STOCK_MONITOR_DATA_DIR;
    } else {
      process.env.STOCK_MONITOR_DATA_DIR = originalDataDirectory;
    }
  });

  it("cancels a pending task through the durable queue state machine", async () => {
    const task = await enqueuePendingTask();
    const response = await POST(localRequest(), {
      params: Promise.resolve({ id: task.id }),
    });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.data.outcome).toBe("CANCELLED");

    const database = await openDatabase(getLocalDatabasePath());
    try {
      expect(readTaskRun(database, task.id)).toMatchObject({
        executionStatus: "SKIPPED",
        resultCode: "CANCELLED",
      });
    } finally {
      database.client.close();
    }
  });

  it("rejects requests from non-local origins before opening the database", async () => {
    const response = await POST(localRequest("https://example.com"), {
      params: Promise.resolve({ id: "0c72b1db-1577-4828-9e25-82af2eadd323" }),
    });
    const result = await response.json();

    expect(response.status).toBe(403);
    expect(result.error.code).toBe("LOCAL_ORIGIN_REQUIRED");
    await expect(
      stat(join(testDataDirectory, "database.sqlite")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
