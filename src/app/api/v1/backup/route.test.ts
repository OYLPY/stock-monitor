import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/backup/route";

const secretSentinel = "P06_06_BACKUP_TEST_SECRET";
const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
const originalApiKey = process.env.OPENAI_API_KEY;
let testDataDirectory = "";

function localRequest(origin = "http://127.0.0.1") {
  return new Request("http://127.0.0.1/api/v1/backup", {
    method: "POST",
    headers: { host: "127.0.0.1", origin },
  });
}

describe("backup route", () => {
  beforeEach(async () => {
    testDataDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-backup-"));
    process.env.STOCK_MONITOR_DATA_DIR = testDataDirectory;
    process.env.OPENAI_API_KEY = secretSentinel;
  });

  afterEach(async () => {
    await rm(testDataDirectory, { recursive: true, force: true });
    if (originalDataDirectory === undefined) {
      delete process.env.STOCK_MONITOR_DATA_DIR;
    } else {
      process.env.STOCK_MONITOR_DATA_DIR = originalDataDirectory;
    }
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it("creates a local SQLite snapshot without returning configured secrets", async () => {
    const response = await POST(localRequest());
    const responseText = await response.text();
    const result = JSON.parse(responseText) as {
      data: { backupDirectory: string; sha256: string; status: string };
    };

    expect(response.status).toBe(200);
    expect(result.data.status).toBe("created");
    expect(result.data.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.backupDirectory).toContain(
      join(testDataDirectory, "backups"),
    );
    expect(
      await readFile(
        join(result.data.backupDirectory, "manifest.json"),
        "utf8",
      ),
    ).toContain("stock-monitor-sqlite-backup");
    expect(responseText).not.toContain(secretSentinel);
  });

  it("rejects a non-local request before creating the database", async () => {
    const response = await POST(localRequest("https://example.com"));
    const result = await response.json();

    expect(response.status).toBe(403);
    expect(result.error.code).toBe("LOCAL_ORIGIN_REQUIRED");
    await expect(
      stat(join(testDataDirectory, "database.sqlite")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("returns a safe error when the local data directory cannot be opened", async () => {
    const blockedPath = join(testDataDirectory, "not-a-directory");
    await writeFile(blockedPath, "block");
    process.env.STOCK_MONITOR_DATA_DIR = blockedPath;

    const response = await POST(localRequest());
    const responseText = await response.text();
    const result = JSON.parse(responseText);

    expect(response.status).toBe(500);
    expect(result.error.code).toBe("BACKUP_FAILED");
    expect(responseText).not.toContain(blockedPath);
    expect(responseText).not.toContain(secretSentinel);
  });
});
