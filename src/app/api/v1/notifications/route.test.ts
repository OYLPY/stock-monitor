import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { GET } from "./route";

const previousDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
let dataDirectory: string | undefined;

afterEach(async () => {
  if (previousDataDirectory === undefined) {
    delete process.env.STOCK_MONITOR_DATA_DIR;
  } else {
    process.env.STOCK_MONITOR_DATA_DIR = previousDataDirectory;
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  dataDirectory = undefined;
});

function request(url: string, host = "127.0.0.1:3000") {
  return new Request(url, {
    headers: { host },
  });
}

describe("local notifications route", () => {
  it("returns only persisted new notifications without caching", async () => {
    dataDirectory = await mkdtemp(
      join(tmpdir(), "stock-monitor-notifications-"),
    );
    process.env.STOCK_MONITOR_DATA_DIR = dataDirectory;
    const initializedDatabase = await openDatabase(getLocalDatabasePath());
    initializedDatabase.client.close();

    const response = await GET(
      request(
        "http://127.0.0.1:3000/api/v1/notifications?afterCreatedAtMs=0&afterId=",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: { notifications: [] },
    });
  });

  it("rejects invalid cursors and non-loopback hosts", async () => {
    const invalidCursor = await GET(
      request(
        "http://127.0.0.1:3000/api/v1/notifications?afterCreatedAtMs=1&afterId=",
      ),
    );
    const remoteHost = await GET(
      request(
        "http://example.test/api/v1/notifications?afterCreatedAtMs=0&afterId=",
        "example.test",
      ),
    );

    expect(invalidCursor.status).toBe(400);
    expect(remoteHost.status).toBe(403);
  });
});
