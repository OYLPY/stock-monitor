import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { precisionRecords } from "./schema.ts";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

function openDatabase(path: string) {
  const client = new Database(path, { timeout: 200 });
  client.defaultSafeIntegers(true);
  client.pragma("foreign_keys = ON");
  client.pragma("busy_timeout = 200");
  client.pragma("synchronous = FULL");
  return client;
}

async function loadMigrations(): Promise<Migration[]> {
  const folder = new URL("./migrations/", import.meta.url);
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", folder), "utf8"),
  ) as MigrationJournal;

  return Promise.all(
    journal.entries.map(async ({ idx, tag }) => ({
      version: idx + 1,
      name: tag,
      sql: await readFile(new URL(`${tag}.sql`, folder), "utf8"),
    })),
  );
}

function applyMigrations(
  client: ReturnType<typeof openDatabase>,
  migrations: Migration[],
) {
  client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
      application_version TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL
    ) STRICT
  `);

  const readApplied = client.prepare(
    "SELECT name, checksum_sha256 FROM schema_migrations WHERE version = ?",
  );
  const writeApplied = client.prepare(
    `INSERT INTO schema_migrations
      (version, name, checksum_sha256, application_version, applied_at_ms)
      VALUES (?, ?, ?, ?, ?)`,
  );

  for (const migration of migrations) {
    const checksum = createHash("sha256").update(migration.sql).digest("hex");
    const applyOne = client.transaction(() => {
      const applied = readApplied.get(migration.version) as
        { name: string; checksum_sha256: string } | undefined;

      if (applied) {
        if (
          applied.name !== migration.name ||
          applied.checksum_sha256 !== checksum
        ) {
          throw new Error(`migration_checksum_mismatch:${migration.version}`);
        }
        return;
      }

      const currentVersion = client.pragma("user_version", { simple: true });
      if (currentVersion !== BigInt(migration.version - 1)) {
        throw new Error(`migration_version_mismatch:${migration.version}`);
      }

      client.exec(migration.sql);
      writeApplied.run(
        migration.version,
        migration.name,
        checksum,
        "0.1.0",
        Date.now(),
      );
      client.pragma(`user_version = ${migration.version}`);
    });

    applyOne.immediate();
  }

  const userVersion = client.pragma("user_version", { simple: true });
  const appliedVersion = client
    .prepare("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
    .pluck()
    .get();
  if (userVersion !== appliedVersion) {
    throw new Error("migration_version_mismatch:history");
  }
}

function parseScaledDecimal(value: string, scale: number) {
  const parsed = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!parsed) throw new RangeError("invalid_decimal");

  const fraction = parsed[3] ?? "";
  if (fraction.length > scale)
    throw new RangeError("fractional_precision_exceeded");

  const factor = BigInt(10) ** BigInt(scale);
  const minor =
    BigInt(parsed[2]) * factor + BigInt(fraction.padEnd(scale, "0") || "0");
  return parsed[1] === "-" ? -minor : minor;
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function isBusy(error: unknown) {
  return errorCode(error)?.startsWith("SQLITE_BUSY") ?? false;
}

function runLockProbe(databasePath: string) {
  const client = openDatabase(databasePath);
  try {
    client
      .transaction(() => {
        client
          .prepare("INSERT INTO lock_probe (value) VALUES (?)")
          .run("child");
      })
      .immediate();
    process.stdout.write(`${JSON.stringify({ outcome: "written" })}\n`);
  } catch (error) {
    const code = errorCode(error) ?? "unknown";
    process.stdout.write(
      `${JSON.stringify({ outcome: isBusy(error) ? "busy" : "failed", errorCode: code })}\n`,
    );
    process.exitCode = isBusy(error) ? 2 : 1;
  } finally {
    client.close();
  }
}

function spawnLockProbe(databasePath: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(import.meta.url),
      "lock-probe",
      databasePath,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.error, undefined);
  const output = JSON.parse(result.stdout) as {
    outcome: string;
    errorCode?: string;
  };
  return { exitCode: result.status, ...output };
}

async function run() {
  const directory = await mkdtemp(join(tmpdir(), "stock-monitor-p04-02-"));
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedDirectory = resolve(directory);
  assert.ok(resolvedDirectory.startsWith(`${resolvedTempRoot}${sep}`));
  const databasePath = join(directory, "proof.sqlite");
  const migrations = await loadMigrations();
  const client = openDatabase(databasePath);

  try {
    assert.equal(client.pragma("journal_mode = WAL", { simple: true }), "wal");
    applyMigrations(client, migrations);

    const usdMinor = parseScaledDecimal("90071992547409.93", 2);
    const priceMantissa = parseScaledDecimal("9876543.2100", 4);
    const record = {
      id: "numeric-boundary-fixture",
      jpyMinor: parseScaledDecimal("9007199254740993", 0),
      usdMinor,
      usdJpyMantissa: parseScaledDecimal("149.123456", 6),
      usdJpyScale: 6,
      priceMantissa,
      priceScale: 4,
      shareQuantity: BigInt(1000000000),
    };
    const notional =
      (record.priceMantissa * record.shareQuantity) / BigInt(10) ** BigInt(4);

    assert.equal(record.jpyMinor, BigInt("9007199254740993"));
    assert.equal(usdMinor, BigInt("9007199254740993"));
    assert.equal(record.usdJpyMantissa, BigInt("149123456"));
    assert.equal(notional, BigInt("9876543210000000"));
    assert.ok(notional > BigInt(Number.MAX_SAFE_INTEGER));
    assert.throws(() => parseScaledDecimal("1.25", 0), RangeError);
    assert.throws(() => parseScaledDecimal("1.001", 2), RangeError);

    const database = drizzle({ client, schema: { precisionRecords } });
    const returned = database
      .insert(precisionRecords)
      .values(record)
      .returning()
      .get();
    assert.deepEqual(returned, record);
    assert.throws(
      () =>
        database
          .insert(precisionRecords)
          .values({
            ...record,
            id: "overflow",
            usdMinor: BigInt("9223372036854775808"),
          })
          .run(),
      RangeError,
    );

    const atomicWrite = client.transaction(() => {
      database
        .insert(precisionRecords)
        .values({ ...record, id: "atomic-first" })
        .run();
      database
        .insert(precisionRecords)
        .values({ ...record, id: "atomic-failure", priceScale: 9 })
        .run();
    });
    assert.throws(() => atomicWrite.immediate(), {
      code: "SQLITE_CONSTRAINT_CHECK",
    });
    assert.equal(
      client
        .prepare("SELECT id FROM precision_records WHERE id = ?")
        .get("atomic-first"),
      undefined,
    );

    const brokenMigration: Migration = {
      version: 2,
      name: "rollback-fixture",
      sql: `CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY) STRICT;
        INSERT INTO rollback_probe (id) VALUES (1.5);`,
    };
    assert.throws(() => applyMigrations(client, [brokenMigration]), {
      code: "SQLITE_MISMATCH",
    });
    assert.equal(
      client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      client
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
        .pluck()
        .get(),
      BigInt(1),
    );
    assert.equal(client.pragma("user_version", { simple: true }), BigInt(1));

    const schemaSql = client
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'precision_records'",
      )
      .pluck()
      .get() as string | undefined;
    assert.ok(schemaSql);
    assert.match(schemaSql, /\) STRICT$/);
    client.exec("CREATE TABLE lock_probe (value TEXT NOT NULL) STRICT");
    client.exec("BEGIN IMMEDIATE");
    let blockedWriter: ReturnType<typeof spawnLockProbe>;
    try {
      blockedWriter = spawnLockProbe(databasePath);
    } finally {
      client.exec("ROLLBACK");
    }
    assert.equal(blockedWriter.outcome, "busy");
    assert.equal(blockedWriter.exitCode, 2);
    assert.equal(spawnLockProbe(databasePath).outcome, "written");
    client.close();

    const reopened = openDatabase(databasePath);
    try {
      applyMigrations(reopened, migrations);
      const reopenedDatabase = drizzle({
        client: reopened,
        schema: { precisionRecords },
      });
      const persisted = reopenedDatabase
        .select()
        .from(precisionRecords)
        .where(eq(precisionRecords.id, record.id))
        .get();
      assert.deepEqual(persisted, record);
      assert.equal(
        reopened.pragma("foreign_keys", { simple: true }),
        BigInt(1),
      );
      assert.equal(
        reopened.prepare("PRAGMA integrity_check").pluck().get(),
        "ok",
      );
      assert.equal(
        reopened
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
          .pluck()
          .get(),
        BigInt(1),
      );
      assert.equal(
        reopened.pragma("user_version", { simple: true }),
        BigInt(1),
      );
      assert.equal(
        reopened
          .prepare("SELECT COUNT(*) AS count FROM lock_probe")
          .pluck()
          .get(),
        BigInt(1),
      );

      const changedMigration = {
        ...migrations[0],
        sql: `${migrations[0].sql}\n-- changed`,
      };
      assert.throws(
        () => applyMigrations(reopened, [changedMigration]),
        /migration_checksum_mismatch/,
      );

      const version = reopened
        .prepare("SELECT sqlite_version() AS version")
        .pluck()
        .get();
      process.stdout.write(
        `${JSON.stringify({
          mode: "sqlite-feasibility",
          outcome: "passed",
          node: process.version,
          betterSqlite3: "13.2.0",
          drizzleOrm: "0.45.4",
          drizzleKit: "0.31.11",
          sqlite: version,
          journalMode: "wal",
          migrated: true,
          idempotentMigration: true,
          migrationChecksumEnforced: true,
          userVersionSynchronized: true,
          rollbackAtomic: true,
          writeRollbackAtomic: true,
          jpyAndUsdBigIntRoundTrip: true,
          returningPreservesBigInt: true,
          sqliteInt64OverflowRejected: true,
          crossProcessLock: blockedWriter.errorCode,
          writeAfterLockRelease: true,
          restartRead: true,
          foreignKeysEnabled: true,
          integrityCheck: "ok",
          externalRequests: 0,
          credentials: "not_required",
          marketData: "none",
          fixture: "synthetic numeric boundary values",
        })}\n`,
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (client.open) client.close();
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "lock-probe") {
  runLockProbe(process.argv[3]);
} else {
  run().catch((error: unknown) => {
    process.stdout.write(
      `${JSON.stringify({ mode: "sqlite-feasibility", outcome: "failed", errorCode: errorCode(error) ?? "SELF_CHECK_FAILED" })}\n`,
    );
    process.exitCode = 1;
  });
}
