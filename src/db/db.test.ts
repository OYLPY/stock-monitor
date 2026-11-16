import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, withTransaction } from "./index";
import { migrateDatabase } from "./migrate";
import { initializeDefaultPaperAccount } from "./paper-account-repository";
import {
  cashLedgerEntries,
  initialCapitalConfigs,
  ledgerEvents,
  paperAccounts,
} from "./schema";
import { createTestDatabase } from "./test-database";

type SqliteClient = InstanceType<typeof Database>;

describe("local SQLite database", () => {
  it("migrates a new file and safely starts again", async () => {
    const fixture = await createTestDatabase();
    try {
      const { client, orm } = fixture.database;
      expect(client.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(client.pragma("foreign_keys", { simple: true })).toBe(BigInt(1));
      expect(client.pragma("user_version", { simple: true })).toBe(BigInt(1));
      expect(
        (
          client
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'paper_accounts'",
            )
            .get() as { sql: string }
        ).sql,
      ).toMatch(/STRICT/);
      expect(orm.select().from(initialCapitalConfigs).all()).toEqual([
        {
          version: 1,
          configKey: "initial-capital-v1",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(1_000_000),
        },
      ]);
      expect(orm.select().from(paperAccounts).all()).toEqual([]);
      expect(
        client
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
          .pluck()
          .get(),
      ).toBe(BigInt(1));

      client.close();
      const restarted = await openDatabase(fixture.filePath);
      try {
        expect(restarted.client.pragma("user_version", { simple: true })).toBe(
          BigInt(1),
        );
        expect(
          restarted.orm.select().from(initialCapitalConfigs).all(),
        ).toHaveLength(1);
        expect(
          restarted.client
            .prepare("SELECT COUNT(*) FROM schema_migrations")
            .pluck()
            .get(),
        ).toBe(BigInt(1));
      } finally {
        restarted.client.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("rolls back all writes when a transaction fails", async () => {
    const fixture = await createTestDatabase();
    try {
      expect(() =>
        withTransaction(fixture.database, () => {
          fixture.database.orm
            .insert(paperAccounts)
            .values({
              id: "rollback-account",
              accountKey: "local-default",
              baseCurrency: "JPY",
              initialCapitalVersion: 1,
              initializedAtMs: BigInt(1),
            })
            .run();
          fixture.database.orm
            .insert(ledgerEvents)
            .values({
              id: "rollback-event",
              accountId: "rollback-account",
              sequenceNo: BigInt(1),
              eventType: "ACCOUNT_OPENED",
              idempotencyKey: "rollback-opening",
              effectiveAtMs: BigInt(1),
              recordedAtMs: BigInt(1),
            })
            .run();
          fixture.database.orm
            .insert(cashLedgerEntries)
            .values({
              id: "rollback-cash",
              ledgerEventId: "rollback-event",
              bucket: "SETTLED",
              currencyCode: "JPY",
              currencyScale: 0,
              amountMinor: BigInt(1_000_000),
            })
            .run();
          throw new Error("rollback_probe");
        }),
      ).toThrow("rollback_probe");

      expect(fixture.database.orm.select().from(paperAccounts).all()).toEqual(
        [],
      );
      expect(fixture.database.orm.select().from(ledgerEvents).all()).toEqual(
        [],
      );
      expect(
        fixture.database.orm.select().from(cashLedgerEntries).all(),
      ).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("snapshots a migrated database before applying the next migration", async () => {
    const fixture = await createTestDatabase();
    let snapshotClient: SqliteClient | undefined;
    try {
      const migrationsDirectory = join(dirname(fixture.filePath), "migrations");
      const metadataDirectory = join(migrationsDirectory, "meta");
      await mkdir(metadataDirectory, { recursive: true });
      const initialMigrationSql = await readFile(
        join(process.cwd(), "src", "db", "migrations", "0000_initial.sql"),
        "utf8",
      );
      await writeFile(
        join(migrationsDirectory, "0000_initial.sql"),
        initialMigrationSql,
      );
      await writeFile(
        join(migrationsDirectory, "0001_migration_probe.sql"),
        "CREATE TABLE migration_probe (id TEXT PRIMARY KEY NOT NULL) STRICT;\n",
      );
      await writeFile(
        join(metadataDirectory, "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "sqlite",
          entries: [
            { idx: 0, version: "6", when: 1, tag: "0000_initial" },
            {
              idx: 1,
              version: "6",
              when: 2,
              tag: "0001_migration_probe",
            },
          ],
        }),
      );

      await migrateDatabase(fixture.database.client, migrationsDirectory);
      expect(
        fixture.database.client.pragma("user_version", { simple: true }),
      ).toBe(BigInt(2));
      expect(
        fixture.database.client
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(1));

      const snapshots = (await readdir(dirname(fixture.filePath))).filter(
        (file) => file.includes(".pre-v2-") && file.endsWith(".sqlite"),
      );
      expect(snapshots).toHaveLength(1);
      snapshotClient = new Database(
        join(dirname(fixture.filePath), snapshots[0]),
      );
      snapshotClient.defaultSafeIntegers(true);
      expect(snapshotClient.pragma("user_version", { simple: true })).toBe(
        BigInt(1),
      );
      expect(
        snapshotClient
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(0));

      await writeFile(
        join(migrationsDirectory, "0000_initial.sql"),
        `${initialMigrationSql}\n-- altered after application\n`,
      );
      await expect(
        migrateDatabase(fixture.database.client, migrationsDirectory),
      ).rejects.toThrow("migration_checksum_mismatch:1");
      await writeFile(
        join(migrationsDirectory, "0000_initial.sql"),
        initialMigrationSql,
      );

      await writeFile(
        join(migrationsDirectory, "0002_failed.sql"),
        "CREATE TABLE migration_partial (id TEXT PRIMARY KEY NOT NULL) STRICT;\nINSERT INTO missing_table (id) VALUES ('failure');\n",
      );
      await writeFile(
        join(metadataDirectory, "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "sqlite",
          entries: [
            { idx: 0, version: "6", when: 1, tag: "0000_initial" },
            {
              idx: 1,
              version: "6",
              when: 2,
              tag: "0001_migration_probe",
            },
            { idx: 2, version: "6", when: 3, tag: "0002_failed" },
          ],
        }),
      );
      await expect(
        migrateDatabase(fixture.database.client, migrationsDirectory),
      ).rejects.toThrow("no such table: missing_table");
      expect(
        fixture.database.client.pragma("user_version", { simple: true }),
      ).toBe(BigInt(2));
      expect(
        fixture.database.client
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_partial'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(0));
      expect(
        fixture.database.client
          .prepare("SELECT COUNT(*) FROM schema_migrations")
          .pluck()
          .get(),
      ).toBe(BigInt(2));
    } finally {
      snapshotClient?.close();
      await fixture.cleanup();
    }
  });

  it("records only the versioned opening capital and rejects a reset", async () => {
    const fixture = await createTestDatabase();
    try {
      const account = initializeDefaultPaperAccount(fixture.database);
      expect(account.initialCapitalVersion).toBe(1);
      expect(
        fixture.database.orm.select().from(ledgerEvents).all(),
      ).toMatchObject([
        {
          accountId: account.id,
          sequenceNo: BigInt(1),
          eventType: "ACCOUNT_OPENED",
          idempotencyKey: "account-opening:v1",
        },
      ]);
      expect(
        fixture.database.orm.select().from(cashLedgerEntries).all(),
      ).toMatchObject([
        {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(1_000_000),
        },
      ]);
      expect(
        fixture.database.orm.select().from(initialCapitalConfigs).all(),
      ).toHaveLength(1);
      expect(() =>
        fixture.database.orm
          .update(initialCapitalConfigs)
          .set({ amountMinor: BigInt(2) })
          .where(eq(initialCapitalConfigs.version, 1))
          .run(),
      ).toThrow("initial_capital_configs are immutable");
      expect(() =>
        fixture.database.orm
          .delete(paperAccounts)
          .where(eq(paperAccounts.id, account.id))
          .run(),
      ).toThrow("paper_accounts are immutable");
      expect(() => initializeDefaultPaperAccount(fixture.database)).toThrow(
        "paper_account_already_initialized",
      );
      expect(
        fixture.database.orm.select().from(ledgerEvents).all(),
      ).toHaveLength(1);
      expect(
        fixture.database.orm.select().from(cashLedgerEntries).all(),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("surfaces a competing writer and succeeds after the lock is released", async () => {
    const fixture = await createTestDatabase();
    const lockHolder = new Database(fixture.filePath, { timeout: 200 });
    try {
      lockHolder.exec("BEGIN IMMEDIATE");
      let conflict: unknown;
      try {
        initializeDefaultPaperAccount(fixture.database);
      } catch (error) {
        conflict = error;
      }

      const code =
        typeof conflict === "object" && conflict !== null && "code" in conflict
          ? conflict.code
          : undefined;
      expect(typeof code).toBe("string");
      expect(code).toMatch(/^SQLITE_BUSY/);
      expect(fixture.database.orm.select().from(paperAccounts).all()).toEqual(
        [],
      );

      lockHolder.exec("ROLLBACK");
      expect(initializeDefaultPaperAccount(fixture.database).id).toBeTruthy();
    } finally {
      if (lockHolder.inTransaction) lockHolder.exec("ROLLBACK");
      lockHolder.close();
      await fixture.cleanup();
    }
  });
});
