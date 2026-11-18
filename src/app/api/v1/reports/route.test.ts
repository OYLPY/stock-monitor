import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabasePath, openDatabase } from "@/db";
import { readTaskRun } from "@/features/task-queue/queue";
import { POST } from "./route";

const previousDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let dataDirectory: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousDataDirectory === undefined) {
    delete process.env.STOCK_MONITOR_DATA_DIR;
  } else {
    process.env.STOCK_MONITOR_DATA_DIR = previousDataDirectory;
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
});

function request(body: URLSearchParams, origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/v1/reports", {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      host: "127.0.0.1:3000",
      origin,
    },
    body: body.toString(),
  });
}

describe("report task route", () => {
  it("queues an explicitly selected report and deduplicates a repeated form submission", async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-reports-"));
    process.env.STOCK_MONITOR_DATA_DIR = dataDirectory;
    const initializedDatabase = await openDatabase(getLocalDatabasePath());
    initializedDatabase.client.close();
    let nowMs = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => {
      const current = nowMs;
      nowMs += 1_000;
      return current;
    });
    const requestId = randomUUID();
    const form = new URLSearchParams({ requestId, type: "ANOMALY" });

    const first = await POST(request(form));
    const firstTaskId = new URL(
      first.headers.get("location")!,
      "http://local",
    ).searchParams.get("task");
    const replay = await POST(request(form));
    const replayTaskId = new URL(
      replay.headers.get("location")!,
      "http://local",
    ).searchParams.get("task");

    const database = await openDatabase(getLocalDatabasePath());
    try {
      const task = firstTaskId ? readTaskRun(database, firstTaskId) : null;
      expect(first.status).toBe(303);
      expect(replay.status).toBe(303);
      expect(replayTaskId).toBe(firstTaskId);
      expect(task).toMatchObject({
        runType: "RESEARCH_REPORT",
        inputJson: '{"type":"ANOMALY"}',
        executionStatus: "PENDING",
      });
      expect(
        database.client
          .prepare("SELECT COUNT(*) FROM task_runs WHERE run_type = ?")
          .pluck()
          .get("RESEARCH_REPORT"),
      ).toBe(BigInt(1));
    } finally {
      database.client.close();
    }
  });

  it("rejects cross-origin submissions", async () => {
    const response = await POST(
      request(
        new URLSearchParams({ requestId: randomUUID(), type: "MORNING" }),
        "http://example.test",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/reports?enqueue=error");
  });
});
