import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  cashLedgerEntries,
  initialCapitalConfigs,
  ledgerEvents,
  paperAccounts,
} from "./schema";
import { migrateDatabase } from "./migrate";

const schema = {
  cashLedgerEntries,
  initialCapitalConfigs,
  ledgerEvents,
  paperAccounts,
};

function createSqliteClient(filePath: string) {
  if (!isAbsolute(filePath)) throw new Error("database_path_must_be_absolute");
  mkdirSync(dirname(filePath), { recursive: true });

  const client = new Database(filePath, { timeout: 200 });
  try {
    client.defaultSafeIntegers(true);
    client.pragma("foreign_keys = ON");
    client.pragma("busy_timeout = 200");
    client.pragma("synchronous = FULL");
    if (client.pragma("journal_mode = WAL", { simple: true }) !== "wal") {
      throw new Error("sqlite_wal_unavailable");
    }
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export async function openDatabase(filePath: string) {
  const client = createSqliteClient(filePath);
  try {
    await migrateDatabase(client);
    return { client, orm: drizzle({ client, schema }) };
  } catch (error) {
    client.close();
    throw error;
  }
}

export type AppDatabase = Awaited<ReturnType<typeof openDatabase>>;

export function withTransaction<T>(database: AppDatabase, work: () => T): T {
  return database.client.transaction(work).immediate();
}
