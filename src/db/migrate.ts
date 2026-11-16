import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type Database from "better-sqlite3";

type SqliteClient = Database.Database;

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

interface AppliedMigration {
  migration_name: string;
  checksum_sha256: string;
}

export async function migrateDatabase(
  client: SqliteClient,
  migrationsDirectory = join(process.cwd(), "src", "db", "migrations"),
) {
  const journal = JSON.parse(
    readFileSync(join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
  ) as MigrationJournal;

  if (journal.entries.length === 0) throw new Error("migration_journal_empty");

  const migrations = journal.entries.map(({ idx, tag }, index) => {
    if (
      idx !== index ||
      !Number.isSafeInteger(idx) ||
      !/^\d{4}_[a-z0-9_]+$/.test(tag)
    ) {
      throw new Error(`migration_journal_invalid:${idx}`);
    }

    const name = `${tag}.sql`;
    return {
      version: idx + 1,
      name,
      sql: readFileSync(join(migrationsDirectory, name), "utf8"),
    };
  });

  client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      migration_name TEXT NOT NULL UNIQUE,
      checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
      application_version TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL
    ) STRICT
  `);
  const packageManifest = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { version: string };

  const readApplied = client.prepare(
    "SELECT migration_name, checksum_sha256 FROM schema_migrations WHERE version = ?",
  );
  const writeApplied = client.prepare(
    `INSERT INTO schema_migrations
      (version, migration_name, checksum_sha256, application_version, applied_at_ms)
      VALUES (?, ?, ?, ?, ?)`,
  );
  let appliedNewMigration = false;

  for (const migration of migrations) {
    const checksum = createHash("sha256").update(migration.sql).digest("hex");
    const existing = readApplied.get(migration.version) as
      AppliedMigration | undefined;
    if (!existing && migration.version > 1) {
      const currentVersion = client.pragma("user_version", {
        simple: true,
      }) as bigint | number;
      if (BigInt(currentVersion) !== BigInt(migration.version - 1)) {
        throw new Error(`migration_version_mismatch:${migration.version}`);
      }
      await client.backup(
        join(
          dirname(client.name),
          `${basename(client.name)}.pre-v${migration.version}-${randomUUID()}.sqlite`,
        ),
      );
    }

    const applyOne = client.transaction(() => {
      const applied = readApplied.get(migration.version) as
        AppliedMigration | undefined;

      if (applied) {
        if (
          applied.migration_name !== migration.name ||
          applied.checksum_sha256 !== checksum
        ) {
          throw new Error(`migration_checksum_mismatch:${migration.version}`);
        }
        return false;
      }

      const currentVersion = client.pragma("user_version", {
        simple: true,
      }) as bigint | number;
      if (BigInt(currentVersion) !== BigInt(migration.version - 1)) {
        throw new Error(`migration_version_mismatch:${migration.version}`);
      }

      client.exec(migration.sql);
      writeApplied.run(
        migration.version,
        migration.name,
        checksum,
        packageManifest.version,
        Date.now(),
      );
      client.pragma(`user_version = ${migration.version}`);
      return true;
    });

    appliedNewMigration ||= applyOne.immediate();
  }

  const userVersion = client.pragma("user_version", {
    simple: true,
  }) as bigint | number;
  const recordedVersion = client
    .prepare("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
    .pluck()
    .get() as bigint | number;
  if (
    BigInt(userVersion) !== BigInt(recordedVersion) ||
    BigInt(recordedVersion) !== BigInt(migrations.length)
  ) {
    throw new Error("migration_version_mismatch:history");
  }

  if (appliedNewMigration) {
    const integrity = client.pragma("integrity_check", {
      simple: true,
    }) as string;
    if (integrity !== "ok")
      throw new Error(`sqlite_integrity_check:${integrity}`);

    const foreignKeyViolations = client.pragma(
      "foreign_key_check",
    ) as unknown[];
    if (foreignKeyViolations.length > 0)
      throw new Error("sqlite_foreign_key_check_failed");
  }
}
