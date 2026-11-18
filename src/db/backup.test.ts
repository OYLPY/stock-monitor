import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupDatabase, preflightBackup, restoreDatabase } from "./backup";
import { openDatabase } from "./index";
import { initializeDefaultPaperAccount } from "./paper-account-repository";
import { cashLedgerEntries, ledgerEvents, paperAccounts } from "./schema";
import { createTestDatabase } from "./test-database";
import { auditPaperLedger } from "@/features/paper/audit";
import { appendPaperLedgerEvent } from "@/features/paper/ledger";
import { createPaperEquitySnapshot } from "@/features/risk/drawdown";

describe("SQLite backup and restore", () => {
  it("backs up a live WAL database and restores its known paper ledger", async () => {
    const fixture = await createTestDatabase();
    const backupDirectory = join(dirname(fixture.filePath), "backup");
    const restoredFile = join(dirname(fixture.filePath), "restored.sqlite");

    try {
      initializeDefaultPaperAccount(fixture.database);
      appendPaperLedgerEvent(fixture.database, {
        eventType: "FEE",
        idempotencyKey: "backup-test-fee",
        effectiveAtMs: BigInt(Date.now()),
        ruleVersion: "paper-fee-v1",
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-100_000),
        },
      });
      createPaperEquitySnapshot(fixture.database, BigInt(Date.now()));
      const originalAudit = auditPaperLedger(fixture.database);
      expect(originalAudit?.equity.status).toBe("VERIFIED");
      const originalEvents = fixture.database.orm
        .select()
        .from(ledgerEvents)
        .all();
      const originalCash = fixture.database.orm
        .select()
        .from(cashLedgerEntries)
        .all();

      const backup = await backupDatabase(fixture.filePath, backupDirectory);
      expect(backup.status).toBe("created");
      expect(await preflightBackup(backupDirectory)).toMatchObject({
        status: "valid",
        sourceSchemaVersion: 9,
        restoredSchemaVersion: 9,
      });

      await restoreDatabase(backupDirectory, restoredFile);
      const restored = await openDatabase(restoredFile);
      try {
        expect(auditPaperLedger(restored)).toEqual(originalAudit);
        expect(restored.orm.select().from(ledgerEvents).all()).toEqual(
          originalEvents,
        );
        expect(restored.orm.select().from(cashLedgerEntries).all()).toEqual(
          originalCash,
        );
      } finally {
        restored.client.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("recovers the committed ledger after an interrupted SQLite write", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);
      const accountId = fixture.database.orm
        .select({ id: paperAccounts.id })
        .from(paperAccounts)
        .get()!.id;
      const auditBefore = auditPaperLedger(fixture.database);
      fixture.database.client.close();

      const childScript = [
        'const Database = require("better-sqlite3");',
        "const db = new Database(process.argv[1]);",
        'db.pragma("foreign_keys = ON");',
        'db.exec("PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;");',
        "const now = Date.now();",
        'db.prepare("INSERT INTO ledger_events (id, account_id, sequence_no, event_type, idempotency_key, effective_at_ms, recorded_at_ms, rule_version) VALUES (?, ?, 2, \'FEE\', ?, ?, ?, \'paper-fee-v1\')").run("interrupted", process.argv[2], "interrupted-write", now, now);',
        "process.exit(0);",
      ].join("\n");
      const child = spawnSync(
        process.execPath,
        ["-e", childScript, fixture.filePath, accountId],
        { encoding: "utf8" },
      );
      expect(child.status).toBe(0);

      const reopened = await openDatabase(fixture.filePath);
      try {
        expect(auditPaperLedger(reopened)).toEqual(auditBefore);
        expect(reopened.orm.select().from(ledgerEvents).all()).toHaveLength(1);
      } finally {
        reopened.client.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects an existing target without changing its database", async () => {
    const fixture = await createTestDatabase();
    const backupDirectory = join(dirname(fixture.filePath), "backup");
    const existingFile = join(dirname(fixture.filePath), "existing.sqlite");
    const existing = await openDatabase(existingFile);
    try {
      initializeDefaultPaperAccount(existing);
      const before = existing.orm.select().from(ledgerEvents).all();
      await backupDatabase(fixture.filePath, backupDirectory);
      await expect(
        restoreDatabase(backupDirectory, existingFile),
      ).rejects.toMatchObject({
        code: "RESTORE_TARGET_EXISTS",
      });
      expect(existing.orm.select().from(ledgerEvents).all()).toEqual(before);
    } finally {
      existing.client.close();
      await fixture.cleanup();
    }
  });

  it("reports hash corruption and leaves the existing database intact", async () => {
    const fixture = await createTestDatabase();
    const backupDirectory = join(dirname(fixture.filePath), "backup");
    const existingFile = join(dirname(fixture.filePath), "existing.sqlite");
    const existing = await openDatabase(existingFile);
    try {
      initializeDefaultPaperAccount(existing);
      const before = existing.orm.select().from(ledgerEvents).all();
      await backupDatabase(fixture.filePath, backupDirectory);
      const damaged = await readFile(join(backupDirectory, "database.sqlite"));
      damaged[0] = (damaged[0] ?? 0) ^ 1;
      await writeFile(join(backupDirectory, "database.sqlite"), damaged);

      await expect(preflightBackup(backupDirectory)).rejects.toMatchObject({
        code: "DATABASE_HASH_MISMATCH",
      });
      await expect(
        restoreDatabase(
          backupDirectory,
          join(dirname(fixture.filePath), "new.sqlite"),
        ),
      ).rejects.toMatchObject({ code: "DATABASE_HASH_MISMATCH" });
      expect(existing.orm.select().from(ledgerEvents).all()).toEqual(before);
    } finally {
      existing.client.close();
      await fixture.cleanup();
    }
  });

  it("rejects a newer schema and preserves the backup without publishing a target", async () => {
    const fixture = await createTestDatabase();
    const backupDirectory = join(dirname(fixture.filePath), "backup");
    const backupFile = join(backupDirectory, "database.sqlite");
    const manifestPath = join(backupDirectory, "manifest.json");
    const restoredFile = join(dirname(fixture.filePath), "future.sqlite");
    try {
      await backupDatabase(fixture.filePath, backupDirectory);
      const client = new Database(backupFile);
      client
        .prepare(
          `INSERT INTO schema_migrations
            (version, migration_name, checksum_sha256, application_version, applied_at_ms)
            VALUES (10, '0009_future.sql', ?, '99.0.0', ?)`,
        )
        .run("f".repeat(64), Date.now());
      client.pragma("user_version = 10");
      client.close();

      const databaseBytes = await readFile(backupFile);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        byteLength: number;
        sha256: string;
        schemaVersion: number;
        migrations: {
          version: number;
          name: string;
          checksumSha256: string;
        }[];
      };
      manifest.byteLength = databaseBytes.byteLength;
      manifest.sha256 = createHash("sha256")
        .update(databaseBytes)
        .digest("hex");
      manifest.schemaVersion = 10;
      manifest.migrations.push({
        version: 10,
        name: "0009_future.sql",
        checksumSha256: "f".repeat(64),
      });
      await writeFile(manifestPath, JSON.stringify(manifest));
      const backupBefore = await readFile(backupFile);

      await expect(preflightBackup(backupDirectory)).rejects.toMatchObject({
        code: "SCHEMA_INCOMPATIBLE",
      });
      await expect(
        restoreDatabase(backupDirectory, restoredFile),
      ).rejects.toMatchObject({
        code: "SCHEMA_INCOMPATIBLE",
      });
      expect(await readFile(backupFile)).toEqual(backupBefore);
      await expect(readFile(restoredFile)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses to replace an existing backup directory", async () => {
    const fixture = await createTestDatabase();
    const backupDirectory = join(dirname(fixture.filePath), "backup");
    try {
      await mkdir(backupDirectory);
      await writeFile(join(backupDirectory, "keep.txt"), "keep");

      await expect(
        backupDatabase(fixture.filePath, backupDirectory),
      ).rejects.toMatchObject({ code: "BACKUP_DESTINATION_EXISTS" });
      expect(await readFile(join(backupDirectory, "keep.txt"), "utf8")).toBe(
        "keep",
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
