import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { listPaperAccountLedger } from "@/db/paper-account-repository";
import { POST } from "@/app/api/v1/paper-account/initialize/route";

const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let testDataDirectory = "";

function localRequest(
  origin = "http://127.0.0.1",
  idempotencyKey: string = randomUUID(),
  body = JSON.stringify({ confirmed: true }),
) {
  return new Request("http://127.0.0.1/api/v1/paper-account/initialize", {
    method: "POST",
    headers: {
      accept: "application/json",
      host: "127.0.0.1",
      origin,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body,
  });
}

describe("paper account initialization route", () => {
  beforeEach(async () => {
    testDataDirectory = await mkdtemp(
      join(tmpdir(), "stock-monitor-paper-account-"),
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

  it("records fixed opening cash once and safely handles retries", async () => {
    const first = await POST(localRequest());
    const retry = await POST(localRequest());

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    const database = await openDatabase(getLocalDatabasePath());
    try {
      const ledger = listPaperAccountLedger(database);
      expect(ledger?.entries).toHaveLength(1);
      expect(ledger?.entries[0]).toMatchObject({
        eventType: "ACCOUNT_OPENED",
        currencyCode: "JPY",
        amountMinor: BigInt(1_000_000),
      });
    } finally {
      database.client.close();
    }
  });

  it("requires an explicit confirmation and UUIDv4 idempotency key", async () => {
    const unconfirmed = await POST(localRequest(undefined, undefined, "{}"));
    const invalidKey = await POST(localRequest("http://127.0.0.1", "invalid"));

    expect(unconfirmed.status).toBe(400);
    expect(invalidKey.status).toBe(400);
    await expect(
      stat(join(testDataDirectory, "database.sqlite")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-local origins before creating the database", async () => {
    const response = await POST(localRequest("https://example.com"));
    const result = await response.json();

    expect(response.status).toBe(403);
    expect(result.error.code).toBe("LOCAL_ORIGIN_REQUIRED");
    await expect(
      stat(join(testDataDirectory, "database.sqlite")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects oversized JSON bodies before creating the account", async () => {
    const response = await POST(
      localRequest(
        "http://127.0.0.1",
        randomUUID(),
        `{"confirmed":true,"${"x".repeat(70_000)}":1}`,
      ),
    );

    expect(response.status).toBe(413);
    await expect(
      stat(join(testDataDirectory, "database.sqlite")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
