import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  auditEvents,
  cashLedgerEntries,
  equityValuationEvidence,
  equityValuationMarketEvidence,
  equityValuations,
  initialCapitalConfigs,
  instruments,
  ledgerEvents,
  marketEventEvidence,
  marketEventRevisions,
  marketEvents,
  marketWatchSourceWatermarks,
  marketPriceBars,
  notificationDecisions,
  notifications,
  paperAccounts,
  paperFills,
  paperOrderEvents,
  paperOrders,
  paperPlans,
  paperPlanVersions,
  planApprovals,
  planInputEvidence,
  positionLedgerEntries,
  researchReports,
  riskDecisions,
  sourceRecords,
  sources,
  taskRunAttempts,
  taskRunEvents,
  taskRuns,
  workerState,
} from "./schema.ts";
import { migrateDatabase } from "./migrate.ts";

const schema = {
  auditEvents,
  cashLedgerEntries,
  equityValuationEvidence,
  equityValuationMarketEvidence,
  equityValuations,
  initialCapitalConfigs,
  instruments,
  ledgerEvents,
  marketEventEvidence,
  marketEventRevisions,
  marketEvents,
  marketWatchSourceWatermarks,
  marketPriceBars,
  notificationDecisions,
  notifications,
  paperAccounts,
  paperFills,
  paperOrderEvents,
  paperOrders,
  paperPlans,
  paperPlanVersions,
  planApprovals,
  planInputEvidence,
  positionLedgerEntries,
  researchReports,
  riskDecisions,
  sourceRecords,
  sources,
  taskRunAttempts,
  taskRunEvents,
  taskRuns,
  workerState,
};

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

function createSqliteClient(filePath: string) {
  if (!isAbsolute(filePath)) throw new Error("database_path_must_be_absolute");
  mkdirSync(dirname(filePath), { recursive: true });

  const client = new Database(filePath, { timeout: SQLITE_BUSY_TIMEOUT_MS });
  try {
    client.defaultSafeIntegers(true);
    client.pragma("foreign_keys = ON");
    client.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
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

export function getLocalDatabasePath() {
  if (process.env.STOCK_MONITOR_DATA_DIR) {
    return resolve(process.env.STOCK_MONITOR_DATA_DIR, "database.sqlite");
  }

  const dataDirectory =
    process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));

  return resolve(dataDirectory, "stock-monitor", "database.sqlite");
}

export function withTransaction<T>(database: AppDatabase, work: () => T): T {
  return database.client.transaction(work).immediate();
}
