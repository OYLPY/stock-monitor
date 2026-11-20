import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { marketDateAt } from "@/domain/primitives";
import { getLocalDatabasePath, openDatabase } from "@/db";
import {
  auditEvents,
  marketPriceBars,
  sourceRecords,
  sources,
} from "@/db/schema";
import { readTaskRun } from "@/features/task-queue/queue";
import { POST as postUsMarketData } from "@/app/api/v1/market-data/us/route";
import { POST as postReport } from "@/app/api/v1/reports/route";

const previousDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let dataDirectory: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  if (previousDataDirectory === undefined) {
    delete process.env.STOCK_MONITOR_DATA_DIR;
  } else {
    process.env.STOCK_MONITOR_DATA_DIR = previousDataDirectory;
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
});

async function initializeIsolatedDatabase() {
  dataDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-integration-"));
  process.env.STOCK_MONITOR_DATA_DIR = dataDirectory;
  const database = await openDatabase(getLocalDatabasePath());
  const version = Number(
    database.client.pragma("user_version", { simple: true }),
  );
  database.client.close();
  return version;
}

function reportRequest(requestId: string) {
  return new Request("http://127.0.0.1:3000/api/v1/reports", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    },
    body: new URLSearchParams({ requestId, type: "ANOMALY" }).toString(),
  });
}

function marketRequest(symbol: string) {
  return new Request("http://127.0.0.1:3000/api/v1/market-data/us", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify({ symbol }),
  });
}

function taskId(response: Response) {
  return new URL(
    response.headers.get("location")!,
    "http://local",
  ).searchParams.get("task");
}

describe("offline runtime integration", () => {
  it("deduplicates concurrent report submissions and retains the task after database reopen", async () => {
    const migratedVersion = await initializeIsolatedDatabase();
    const requestId = randomUUID();
    const [first, second] = await Promise.all([
      postReport(reportRequest(requestId)),
      postReport(reportRequest(requestId)),
    ]);
    const firstTaskId = taskId(first);
    const secondTaskId = taskId(second);

    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    expect(firstTaskId).toBeTruthy();
    expect(secondTaskId).toBe(firstTaskId);

    const database = await openDatabase(getLocalDatabasePath());
    try {
      expect(
        Number(database.client.pragma("user_version", { simple: true })),
      ).toBe(migratedVersion);
      expect(
        database.client
          .prepare("SELECT COUNT(*) FROM task_runs WHERE run_type = ?")
          .pluck()
          .get("RESEARCH_REPORT"),
      ).toBe(BigInt(1));
      expect(
        database.client
          .prepare(
            "SELECT COUNT(*) FROM task_run_events WHERE event_type = 'TASK_QUEUED'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(1));
      expect(readTaskRun(database, firstTaskId!)).toMatchObject({
        runType: "RESEARCH_REPORT",
        executionStatus: "PENDING",
      });
    } finally {
      database.client.close();
    }
  });

  it("keeps disconnected, stale, and rate-limited provider responses safe and recovers with valid data", async () => {
    const migratedVersion = await initializeIsolatedDatabase();
    const token = "private-test-token";
    const validDate = marketDateAt(Date.now(), "US");
    const csv = (date: string) =>
      `Date,Open,High,Low,Close,Volume\n${date},10,12,9,11,1000`;
    // These deterministic responses stay inside the temporary integration database.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError(`${token}: network disconnected`))
      .mockRejectedValueOnce(
        new DOMException(`${token}: request timed out`, "TimeoutError"),
      )
      .mockResolvedValueOnce(new Response(csv("2000-01-03")))
      .mockResolvedValueOnce(new Response(csv(validDate)))
      .mockResolvedValueOnce(
        new Response(`${token}: provider quota exceeded`, { status: 429 }),
      );
    vi.stubEnv("EODHD_API_TOKEN", token);
    vi.stubGlobal("fetch", fetchMock);
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const invalid = await postUsMarketData(marketRequest("invalid symbol!"));
    const disconnected = await postUsMarketData(marketRequest("AAPL"));
    const timedOut = await postUsMarketData(marketRequest("AAPL"));
    const stale = await postUsMarketData(marketRequest("AAPL"));
    const recovered = await postUsMarketData(marketRequest("AAPL"));
    const rateLimited = await postUsMarketData(marketRequest("MSFT"));
    const bodies = await Promise.all(
      [invalid, disconnected, timedOut, stale, recovered, rateLimited].map(
        (response) => response.text(),
      ),
    );

    expect(invalid.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(disconnected.status).toBe(503);
    expect(JSON.parse(bodies[1]!)).toMatchObject({
      error: { code: "MARKET_DATA_UNAVAILABLE" },
    });
    expect(timedOut.status).toBe(503);
    expect(JSON.parse(bodies[2]!)).toMatchObject({
      error: { code: "MARKET_DATA_UNAVAILABLE" },
    });
    expect(stale.status).toBe(502);
    expect(JSON.parse(bodies[3]!)).toMatchObject({
      error: { code: "MARKET_DATA_INVALID_RESPONSE" },
    });
    expect(recovered.status).toBe(200);
    expect(rateLimited.status).toBe(429);
    expect(JSON.parse(bodies[5]!)).toMatchObject({
      error: { code: "MARKET_DATA_DAILY_LIMIT" },
    });
    expect(bodies.join("\n")).not.toContain(token);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(token);

    const database = await openDatabase(getLocalDatabasePath());
    try {
      expect(
        Number(database.client.pragma("user_version", { simple: true })),
      ).toBe(migratedVersion);
      expect(database.orm.select().from(marketPriceBars).all()).toHaveLength(1);
      expect(
        database.client
          .prepare("SELECT COUNT(*) FROM market_price_bars WHERE symbol = ?")
          .pluck()
          .get("AAPL"),
      ).toBe(BigInt(1));
      const persistedText = JSON.stringify(
        {
          sources: database.orm.select().from(sources).all(),
          sourceRecords: database.orm.select().from(sourceRecords).all(),
          auditEvents: database.orm.select().from(auditEvents).all(),
        },
        (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
      );
      expect(persistedText).not.toContain(token);
      expect(persistedText).not.toContain("network disconnected");
    } finally {
      database.client.close();
    }
  });
});
