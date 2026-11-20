import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { marketDateAt } from "@/domain/primitives";
import { getLocalDatabasePath, openDatabase } from "@/db";
import { marketPriceBars } from "@/db/schema";
import { POST } from "./route";

const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let dataDirectory: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalDataDirectory === undefined) {
    delete process.env.STOCK_MONITOR_DATA_DIR;
  } else {
    process.env.STOCK_MONITOR_DATA_DIR = originalDataDirectory;
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
});

function request() {
  return new Request("http://127.0.0.1:3000/api/v1/market-data/us", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify({ symbol: "AAPL" }),
  });
}

describe("US market data route", () => {
  it("stores mocked EODHD history through the local API without returning the key", async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-us-market-"));
    process.env.STOCK_MONITOR_DATA_DIR = dataDirectory;
    vi.stubEnv("EODHD_API_TOKEN", "private-test-token");
    const date = marketDateAt(Date.now(), "US");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          `Date,Open,High,Low,Close,Volume\n${date},10,12,9,11,1000`,
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(request());
    const firstPayload = await first.json();
    const replay = await POST(request());
    const replayPayload = await replay.json();
    const database = await openDatabase(getLocalDatabasePath());
    try {
      expect(first.status).toBe(200);
      expect(firstPayload.data).toMatchObject({
        symbol: "AAPL",
        rowsAdded: 1,
        rowsReceived: 1,
        dataClass: "HISTORICAL",
        cacheHit: false,
      });
      expect(replay.status).toBe(200);
      expect(replayPayload.data.cacheHit).toBe(true);
      expect(JSON.stringify(firstPayload)).not.toContain("private-test-token");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(database.orm.select().from(marketPriceBars).all()).toHaveLength(1);
    } finally {
      database.client.close();
    }
  });

  it("reports a symbol entitlement failure without exposing the key", async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-us-market-"));
    process.env.STOCK_MONITOR_DATA_DIR = dataDirectory;
    vi.stubEnv("EODHD_API_TOKEN", "private-test-token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret", { status: 403 })),
    );

    const response = await POST(request());
    const payload = await response.text();

    expect(response.status).toBe(403);
    expect(payload).toContain("MARKET_DATA_ACCESS_NOT_ENTITLED");
    expect(payload).not.toContain("private-test-token");
  });
});
