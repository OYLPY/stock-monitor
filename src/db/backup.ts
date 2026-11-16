import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { openDatabase } from "./index.ts";

const manifestSchema = z.strictObject({
  format: z.literal("stock-monitor-sqlite-backup"),
  formatVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  applicationVersion: z.string().min(1),
  schemaVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  databaseFile: z.literal("database.sqlite"),
  byteLength: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  migrations: z.array(
    z.strictObject({
      version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      name: z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/),
      checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});

type BackupManifest = z.infer<typeof manifestSchema>;

interface DatabaseState {
  schemaVersion: number;
  migrations: BackupManifest["migrations"];
}

export class BackupOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function absolutePath(filePath: string) {
  if (!isAbsolute(filePath)) {
    throw new BackupOperationError("PATH_MUST_BE_ABSOLUTE", filePath);
  }
  return resolve(filePath);
}

function databaseState(client: InstanceType<typeof Database>): DatabaseState {
  const integrity = client.pragma("integrity_check") as {
    integrity_check: string;
  }[];
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new BackupOperationError(
      "DATABASE_INTEGRITY_FAILED",
      integrity.map(({ integrity_check }) => integrity_check).join("; "),
    );
  }

  const foreignKeyViolations = client.pragma("foreign_key_check") as {
    table: string;
    rowid: number | bigint;
    parent: string;
    fkid: number;
  }[];
  if (foreignKeyViolations.length > 0) {
    throw new BackupOperationError(
      "DATABASE_FOREIGN_KEY_CHECK_FAILED",
      JSON.stringify(
        foreignKeyViolations.slice(0, 20).map((violation) => ({
          ...violation,
          rowid: String(violation.rowid),
        })),
      ),
    );
  }

  const schemaVersion = Number(
    client.pragma("user_version", { simple: true }) as number | bigint,
  );
  const rows = client
    .prepare(
      "SELECT version, migration_name, checksum_sha256 FROM schema_migrations ORDER BY version",
    )
    .all() as {
    version: number | bigint;
    migration_name: string;
    checksum_sha256: string;
  }[];
  const migrations = rows.map((row, index) => {
    const version = Number(row.version);
    if (
      version !== index + 1 ||
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(row.migration_name) ||
      !/^[a-f0-9]{64}$/.test(row.checksum_sha256)
    ) {
      throw new BackupOperationError(
        "DATABASE_MIGRATION_HISTORY_INVALID",
        `migration row ${index + 1}`,
      );
    }
    return {
      version,
      name: row.migration_name,
      checksumSha256: row.checksum_sha256,
    };
  });

  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion !== migrations.length ||
    migrations.length === 0
  ) {
    throw new BackupOperationError(
      "DATABASE_SCHEMA_VERSION_MISMATCH",
      `user_version=${schemaVersion}, migrations=${migrations.length}`,
    );
  }

  return { schemaVersion, migrations };
}

function parseManifest(value: unknown): BackupManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    throw new BackupOperationError(
      "MANIFEST_INVALID",
      result.error.issues.map((issue) => issue.path.join(".")).join(", "),
    );
  }
  return result.data;
}

async function readManifest(backupDirectory: string) {
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(backupDirectory, "manifest.json"), "utf8"),
    );
  } catch (error) {
    throw new BackupOperationError(
      "MANIFEST_UNREADABLE",
      error instanceof Error ? error.message : String(error),
    );
  }
  return parseManifest(value);
}

function compareManifestDatabase(
  manifest: BackupManifest,
  state: DatabaseState,
) {
  if (
    manifest.schemaVersion !== state.schemaVersion ||
    JSON.stringify(manifest.migrations) !== JSON.stringify(state.migrations)
  ) {
    throw new BackupOperationError(
      "DATABASE_SCHEMA_VERSION_MISMATCH",
      `manifest=${manifest.schemaVersion}, database=${state.schemaVersion}`,
    );
  }
}

function openReadonlyDatabase(filePath: string) {
  const client = new Database(filePath, {
    readonly: true,
    fileMustExist: true,
    timeout: 5000,
  });
  client.defaultSafeIntegers(true);
  client.pragma("foreign_keys = ON");
  return client;
}

async function checkDatabaseFile(filePath: string, manifest: BackupManifest) {
  const fileStats = await stat(filePath);
  if (fileStats.size !== manifest.byteLength) {
    throw new BackupOperationError(
      "DATABASE_SIZE_MISMATCH",
      `expected=${manifest.byteLength}, actual=${fileStats.size}`,
    );
  }
  const checksum = await hashFile(filePath);
  if (checksum !== manifest.sha256) {
    throw new BackupOperationError(
      "DATABASE_HASH_MISMATCH",
      `expected=${manifest.sha256}, actual=${checksum}`,
    );
  }

  let client: InstanceType<typeof Database> | undefined;
  try {
    client = openReadonlyDatabase(filePath);
    const state = databaseState(client);
    compareManifestDatabase(manifest, state);
    return state;
  } catch (error) {
    if (error instanceof BackupOperationError) throw error;
    throw new BackupOperationError(
      "DATABASE_UNREADABLE",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (client?.open) client.close();
  }
}

async function prepareRestore(backupDirectory: string, temporaryRoot: string) {
  const sourceDirectory = absolutePath(backupDirectory);
  const manifest = await readManifest(sourceDirectory);
  const temporaryDirectory = await mkdtemp(
    join(temporaryRoot, ".stock-monitor-restore-"),
  );
  const stagedDatabase = join(temporaryDirectory, "database.sqlite");

  try {
    const backupDatabase = join(sourceDirectory, manifest.databaseFile);
    try {
      await copyFile(backupDatabase, stagedDatabase);
    } catch (error) {
      throw new BackupOperationError(
        "DATABASE_UNREADABLE",
        error instanceof Error ? error.message : String(error),
      );
    }
    const sourceState = await checkDatabaseFile(stagedDatabase, manifest);

    let database: Awaited<ReturnType<typeof openDatabase>> | undefined;
    try {
      database = await openDatabase(stagedDatabase);
      const restoredState = databaseState(database.client);
      const checkpoint = database.client.pragma("wal_checkpoint(TRUNCATE)") as {
        busy: number | bigint;
      }[];
      if (checkpoint.some(({ busy }) => Number(busy) !== 0)) {
        throw new BackupOperationError(
          "RESTORE_CHECKPOINT_FAILED",
          JSON.stringify(checkpoint, (_, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        );
      }
      return {
        temporaryDirectory,
        stagedDatabase,
        manifest,
        sourceState,
        restoredState,
      };
    } catch (error) {
      if (error instanceof BackupOperationError) throw error;
      throw new BackupOperationError(
        "SCHEMA_INCOMPATIBLE",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (database?.client.open) database.client.close();
    }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function backupDatabase(
  sourceFile: string,
  backupDirectory: string,
) {
  const sourcePath = absolutePath(sourceFile);
  const destination = absolutePath(backupDirectory);
  const parentDirectory = dirname(destination);
  await mkdir(parentDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(
    join(parentDirectory, `.${basename(destination)}.tmp-`),
  );
  const stagedDatabase = join(temporaryDirectory, "database.sqlite");
  const stagedManifest = join(temporaryDirectory, "manifest.json");
  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
    timeout: 5000,
  });

  try {
    source.defaultSafeIntegers(true);
    source.pragma("foreign_keys = ON");
    await source.backup(stagedDatabase);

    const snapshot = openReadonlyDatabase(stagedDatabase);
    let state: DatabaseState;
    try {
      state = databaseState(snapshot);
    } catch (error) {
      if (error instanceof BackupOperationError) throw error;
      throw new BackupOperationError(
        "DATABASE_UNREADABLE",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      snapshot.close();
    }

    const packageManifest = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const fileStats = await stat(stagedDatabase);
    const manifest = parseManifest({
      format: "stock-monitor-sqlite-backup",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      applicationVersion: packageManifest.version,
      schemaVersion: state.schemaVersion,
      databaseFile: "database.sqlite",
      byteLength: fileStats.size,
      sha256: await hashFile(stagedDatabase),
      migrations: state.migrations,
    });
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
    });

    try {
      await mkdir(destination);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EEXIST") {
        throw new BackupOperationError(
          "BACKUP_DESTINATION_EXISTS",
          destination,
        );
      }
      throw error;
    }
    await rename(stagedDatabase, join(destination, "database.sqlite"));
    await rename(stagedManifest, join(destination, "manifest.json"));

    return {
      status: "created",
      backupDirectory: destination,
      schemaVersion: manifest.schemaVersion,
      byteLength: manifest.byteLength,
      sha256: manifest.sha256,
      createdAt: manifest.createdAt,
    };
  } finally {
    source.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function preflightBackup(backupDirectory: string) {
  const temporaryRoot = tmpdir();
  await mkdir(temporaryRoot, { recursive: true });
  const staged = await prepareRestore(backupDirectory, temporaryRoot);
  try {
    return {
      status: "valid",
      backupDirectory: absolutePath(backupDirectory),
      applicationVersion: staged.manifest.applicationVersion,
      sourceSchemaVersion: staged.sourceState.schemaVersion,
      restoredSchemaVersion: staged.restoredState.schemaVersion,
      sha256: staged.manifest.sha256,
    };
  } finally {
    await rm(staged.temporaryDirectory, { recursive: true, force: true });
  }
}

export async function restoreDatabase(
  backupDirectory: string,
  destinationFile: string,
) {
  const destination = absolutePath(destinationFile);
  const parentDirectory = dirname(destination);
  await mkdir(parentDirectory, { recursive: true });

  const pathsToCheck = [
    destination,
    `${destination}-wal`,
    `${destination}-shm`,
  ];
  for (const path of pathsToCheck) {
    try {
      await lstat(path);
      throw new BackupOperationError("RESTORE_TARGET_EXISTS", path);
    } catch (error) {
      if (error instanceof BackupOperationError) throw error;
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }

  const staged = await prepareRestore(backupDirectory, parentDirectory);
  try {
    try {
      // shortcut: hard-link support is required for atomic no-replace publication; add a platform-specific publisher only if a target local filesystem lacks it.
      await link(staged.stagedDatabase, destination);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code === "EEXIST") {
        throw new BackupOperationError("RESTORE_TARGET_EXISTS", destination);
      }
      throw error;
    }

    return {
      status: "restored",
      databaseFile: destination,
      applicationVersion: staged.manifest.applicationVersion,
      sourceSchemaVersion: staged.sourceState.schemaVersion,
      restoredSchemaVersion: staged.restoredState.schemaVersion,
      sha256: staged.manifest.sha256,
    };
  } finally {
    await rm(staged.temporaryDirectory, { recursive: true, force: true });
  }
}
