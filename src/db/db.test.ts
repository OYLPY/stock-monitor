import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { getLocalDatabasePath, openDatabase, withTransaction } from "./index";
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
  it("uses an absolute application-data path and respects the local override", () => {
    const previousDirectory = process.env.STOCK_MONITOR_DATA_DIR;
    delete process.env.STOCK_MONITOR_DATA_DIR;
    const defaultPath = getLocalDatabasePath();
    const overrideDirectory = join(tmpdir(), "stock-monitor-override");
    process.env.STOCK_MONITOR_DATA_DIR = overrideDirectory;

    try {
      expect(isAbsolute(defaultPath)).toBe(true);
      expect(
        defaultPath.endsWith(join("stock-monitor", "database.sqlite")),
      ).toBe(true);
      expect(getLocalDatabasePath()).toBe(
        resolve(overrideDirectory, "database.sqlite"),
      );
    } finally {
      if (previousDirectory === undefined) {
        delete process.env.STOCK_MONITOR_DATA_DIR;
      } else {
        process.env.STOCK_MONITOR_DATA_DIR = previousDirectory;
      }
    }
  });

  it("migrates a new file and safely starts again", async () => {
    const fixture = await createTestDatabase();
    try {
      const { client, orm } = fixture.database;
      expect(client.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(client.pragma("foreign_keys", { simple: true })).toBe(BigInt(1));
      expect(client.pragma("user_version", { simple: true })).toBe(BigInt(5));
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
      ).toBe(BigInt(5));

      client.close();
      const restarted = await openDatabase(fixture.filePath);
      try {
        expect(restarted.client.pragma("user_version", { simple: true })).toBe(
          BigInt(5),
        );
        expect(
          restarted.orm.select().from(initialCapitalConfigs).all(),
        ).toHaveLength(1);
        expect(
          restarted.client
            .prepare("SELECT COUNT(*) FROM schema_migrations")
            .pluck()
            .get(),
        ).toBe(BigInt(5));
      } finally {
        restarted.client.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("preserves an existing opening ledger while adding P10 schema", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "stock-monitor-p10-migration-"),
    );
    const migrationDirectory = join(directory, "migrations");
    const metadataDirectory = join(migrationDirectory, "meta");
    const databasePath = join(directory, "database.sqlite");
    const currentMigrationDirectory = join(
      process.cwd(),
      "src",
      "db",
      "migrations",
    );
    let client: SqliteClient | undefined;

    try {
      await mkdir(metadataDirectory, { recursive: true });
      const currentJournal = JSON.parse(
        await readFile(
          join(currentMigrationDirectory, "meta", "_journal.json"),
          "utf8",
        ),
      ) as {
        version: string;
        dialect: string;
        entries: { idx: number; tag: string }[];
      };
      const previousEntries = currentJournal.entries.slice(0, 3);
      await writeFile(
        join(metadataDirectory, "_journal.json"),
        JSON.stringify({ ...currentJournal, entries: previousEntries }),
      );
      for (const { tag } of previousEntries) {
        await copyFile(
          join(currentMigrationDirectory, `${tag}.sql`),
          join(migrationDirectory, `${tag}.sql`),
        );
      }

      client = new Database(databasePath, { timeout: 200 });
      client.defaultSafeIntegers(true);
      client.pragma("foreign_keys = ON");
      await migrateDatabase(client, migrationDirectory);

      const accountId = randomUUID();
      const eventId = randomUUID();
      client
        .prepare(
          `INSERT INTO paper_accounts
            (id, account_key, base_currency, initial_capital_version, initialized_at_ms)
            VALUES (?, 'local-default', 'JPY', 1, ?)`,
        )
        .run(accountId, BigInt(100));
      client
        .prepare(
          `INSERT INTO ledger_events
            (id, account_id, sequence_no, event_type, idempotency_key, effective_at_ms, recorded_at_ms)
            VALUES (?, ?, 1, 'ACCOUNT_OPENED', 'account-opening:v1', 100, 100)`,
        )
        .run(eventId, accountId);
      client
        .prepare(
          `INSERT INTO cash_ledger_entries
            (id, ledger_event_id, bucket, currency_code, currency_scale, amount_minor)
            VALUES (?, ?, 'SETTLED', 'JPY', 0, 1000000)`,
        )
        .run(randomUUID(), eventId);
      const cashBefore = client
        .prepare(
          "SELECT amount_minor FROM cash_ledger_entries WHERE ledger_event_id = ?",
        )
        .pluck()
        .get(eventId);

      await migrateDatabase(client, currentMigrationDirectory);

      expect(
        client
          .prepare(
            "SELECT amount_minor FROM cash_ledger_entries WHERE ledger_event_id = ?",
          )
          .pluck()
          .get(eventId),
      ).toBe(cashBefore);
      expect(
        client
          .prepare("SELECT rule_version FROM ledger_events WHERE id = ?")
          .pluck()
          .get(eventId),
      ).toBe("account-opening-v1");
      expect(
        client.prepare("SELECT COUNT(*) FROM schema_migrations").pluck().get(),
      ).toBe(BigInt(5));
      expect(
        client
          .prepare(
            "SELECT strict FROM pragma_table_list WHERE name = 'position_ledger_entries'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(1));
      expect(client.pragma("foreign_key_check")).toEqual([]);
    } finally {
      if (client?.open) client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("upgrades the observed legacy P10 checksum without losing local records", async () => {
    const fixture = await createTestDatabase();
    let backupClient: SqliteClient | undefined;
    try {
      const { client } = fixture.database;
      const account = initializeDefaultPaperAccount(fixture.database);
      const valuationId = randomUUID();
      const legacyChecksum =
        "492f24e7d6ca9b86cbc22f1d9bf9a806cc106c89e75080e6ccd786f57433adca";
      client.exec(
        "DROP INDEX equity_valuations_input; CREATE UNIQUE INDEX equity_valuations_input ON equity_valuations (account_id, input_hash_sha256, rule_version)",
      );
      client
        .prepare(
          "UPDATE schema_migrations SET checksum_sha256 = ? WHERE version = 4",
        )
        .run(legacyChecksum);
      client.prepare("DELETE FROM schema_migrations WHERE version = 5").run();
      client.pragma("user_version = 4");
      client
        .prepare(
          "INSERT INTO equity_valuations (id, account_id, as_of_ms, ledger_sequence_no, input_hash_sha256, status, equity_minor, currency_code, currency_scale, unresolved_reason, rule_version, created_at_ms) VALUES (?, ?, 100, 1, ?, 'VERIFIED', 1000000, 'JPY', 0, NULL, 'equity-ledger-v1', 100)",
        )
        .run(valuationId, account.id, "a".repeat(64));
      const previousBackups = new Set(await readdir(dirname(fixture.filePath)));

      await migrateDatabase(
        client,
        join(process.cwd(), "src", "db", "migrations"),
      );

      expect(client.pragma("user_version", { simple: true })).toBe(BigInt(5));
      expect(
        client
          .prepare(
            "SELECT checksum_sha256 FROM schema_migrations WHERE version = 4",
          )
          .pluck()
          .get(),
      ).toBe(legacyChecksum);
      expect(
        client
          .prepare("SELECT equity_minor FROM equity_valuations WHERE id = ?")
          .pluck()
          .get(valuationId),
      ).toBe(BigInt(1_000_000));
      expect(
        (
          client
            .prepare("PRAGMA index_info('equity_valuations_input')")
            .all() as { name: string }[]
        ).map(({ name }) => name),
      ).toEqual([
        "account_id",
        "as_of_ms",
        "input_hash_sha256",
        "rule_version",
      ]);

      const snapshotName = (await readdir(dirname(fixture.filePath))).find(
        (file) =>
          file.includes(".pre-v5-") &&
          file.endsWith(".sqlite") &&
          !previousBackups.has(file),
      );
      expect(snapshotName).toBeDefined();
      backupClient = new Database(
        join(dirname(fixture.filePath), snapshotName!),
        { readonly: true },
      );
      backupClient.defaultSafeIntegers(true);
      expect(backupClient.pragma("user_version", { simple: true })).toBe(
        BigInt(4),
      );
      expect(
        backupClient
          .prepare("SELECT equity_minor FROM equity_valuations WHERE id = ?")
          .pluck()
          .get(valuationId),
      ).toBe(BigInt(1_000_000));
    } finally {
      if (backupClient?.open) backupClient.close();
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
    const directory = await mkdtemp(join(tmpdir(), "stock-monitor-migration-"));
    const filePath = join(directory, "test.sqlite");
    const client = new Database(filePath, { timeout: 200 });
    let snapshotClient: SqliteClient | undefined;
    try {
      client.defaultSafeIntegers(true);
      client.pragma("foreign_keys = ON");
      client.pragma("journal_mode = WAL");
      client.pragma("synchronous = FULL");
      const migrationsDirectory = join(directory, "migrations");
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

      await migrateDatabase(client, migrationsDirectory);
      expect(client.pragma("user_version", { simple: true })).toBe(BigInt(2));
      expect(
        client
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(1));

      const snapshots = (await readdir(dirname(filePath))).filter(
        (file) => file.includes(".pre-v2-") && file.endsWith(".sqlite"),
      );
      expect(snapshots).toHaveLength(1);
      snapshotClient = new Database(join(dirname(filePath), snapshots[0]));
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
        migrateDatabase(client, migrationsDirectory),
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
        migrateDatabase(client, migrationsDirectory),
      ).rejects.toThrow("no such table: missing_table");
      expect(client.pragma("user_version", { simple: true })).toBe(BigInt(2));
      expect(
        client
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_partial'",
          )
          .pluck()
          .get(),
      ).toBe(BigInt(0));
      expect(
        client.prepare("SELECT COUNT(*) FROM schema_migrations").pluck().get(),
      ).toBe(BigInt(2));
    } finally {
      snapshotClient?.close();
      client.close();
      await rm(directory, { recursive: true, force: true });
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
