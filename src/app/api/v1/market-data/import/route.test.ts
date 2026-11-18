import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/market-data/import/route";
import { MAX_LOCAL_CSV_BYTES } from "@/providers/market-data/local-csv";

const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let testDataDirectory = "";

function localRequest(body: BodyInit, headers: Record<string, string>) {
  return new Request("http://127.0.0.1/api/v1/market-data/import", {
    method: "POST",
    headers: { host: "127.0.0.1", origin: "http://127.0.0.1", ...headers },
    body,
  });
}

describe("local market CSV import route", () => {
  beforeEach(async () => {
    testDataDirectory = await mkdtemp(
      join(tmpdir(), "stock-monitor-market-import-"),
    );
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

  it("imports a user-provided CSV into its isolated local database", async () => {
    const form = new FormData();
    form.set("market", "US");
    form.set("symbol", "AAPL");
    form.set("rightsConfirmed", "on");
    form.set(
      "file",
      new Blob(
        ["Date,Open,High,Low,Close,Volume\n2024-01-02,10,11,9,10.5,1000"],
        { type: "text/csv" },
      ),
      "prices.csv",
    );

    const response = await POST(
      localRequest(form, { accept: "application/json" }),
    );
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.data).toMatchObject({
      market: "US",
      symbol: "AAPL",
      rowsInFile: 1,
      rowsAdded: 1,
      dataClass: "NOT_VERIFIED",
    });
  });

  it("caps streamed multipart requests even without Content-Length", async () => {
    const response = await POST(
      localRequest(new Uint8Array(MAX_LOCAL_CSV_BYTES + 64 * 1024 + 1), {
        accept: "application/json",
        "content-type": "multipart/form-data; boundary=unused",
      }),
    );
    const result = await response.json();

    expect(response.status).toBe(413);
    expect(result.error.code).toBe("REQUEST_TOO_LARGE");
  });
});
