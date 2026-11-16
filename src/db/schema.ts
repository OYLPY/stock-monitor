import { sql } from "drizzle-orm";
import {
  check,
  customType,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const sqliteInt64 = customType<{ data: bigint; driverData: bigint }>({
  dataType: () => "integer",
});

const sqliteSmallInteger = customType<{
  data: number;
  driverData: bigint | number;
}>({
  dataType: () => "integer",
  toDriver: (value) => {
    if (!Number.isSafeInteger(value))
      throw new RangeError("sqlite_small_integer_out_of_range");
    return BigInt(value);
  },
  fromDriver: (value) => {
    const result = Number(value);
    if (!Number.isSafeInteger(result))
      throw new RangeError("sqlite_small_integer_out_of_range");
    return result;
  },
});

export const initialCapitalConfigs = sqliteTable(
  "initial_capital_configs",
  {
    version: sqliteSmallInteger("version").primaryKey(),
    configKey: text("config_key").notNull().unique(),
    currencyCode: text("currency_code").notNull(),
    currencyScale: sqliteSmallInteger("currency_scale").notNull(),
    amountMinor: sqliteInt64("amount_minor").notNull(),
  },
  (table) => [
    check("initial_capital_configs_version", sql`${table.version} > 0`),
    check(
      "initial_capital_configs_currency",
      sql`${table.currencyCode} = 'JPY' AND ${table.currencyScale} = 0`,
    ),
    check("initial_capital_configs_amount", sql`${table.amountMinor} > 0`),
  ],
);

export const paperAccounts = sqliteTable(
  "paper_accounts",
  {
    id: text("id").primaryKey(),
    accountKey: text("account_key").notNull().unique(),
    baseCurrency: text("base_currency").notNull(),
    initialCapitalVersion: sqliteSmallInteger("initial_capital_version")
      .notNull()
      .references(() => initialCapitalConfigs.version, {
        onDelete: "restrict",
      }),
    initializedAtMs: sqliteInt64("initialized_at_ms").notNull(),
  },
  (table) => [
    check("paper_accounts_key", sql`${table.accountKey} = 'local-default'`),
    check("paper_accounts_currency", sql`${table.baseCurrency} = 'JPY'`),
  ],
);

export const ledgerEvents = sqliteTable(
  "ledger_events",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "restrict" }),
    sequenceNo: sqliteInt64("sequence_no").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    effectiveAtMs: sqliteInt64("effective_at_ms").notNull(),
    recordedAtMs: sqliteInt64("recorded_at_ms").notNull(),
  },
  (table) => [
    check("ledger_events_sequence", sql`${table.sequenceNo} > 0`),
    check(
      "ledger_events_type",
      sql`${table.eventType} IN ('ACCOUNT_OPENED', 'RESERVATION', 'RELEASE', 'FILL', 'FEE', 'FX_CONVERSION', 'SETTLEMENT', 'CORPORATE_ACTION', 'REVERSAL')`,
    ),
    uniqueIndex("ledger_events_account_sequence").on(
      table.accountId,
      table.sequenceNo,
    ),
    uniqueIndex("ledger_events_account_idempotency").on(
      table.accountId,
      table.idempotencyKey,
    ),
    uniqueIndex("ledger_one_opening_event_per_account")
      .on(table.accountId)
      .where(sql`${table.eventType} = 'ACCOUNT_OPENED'`),
  ],
);

export const cashLedgerEntries = sqliteTable(
  "cash_ledger_entries",
  {
    id: text("id").primaryKey(),
    ledgerEventId: text("ledger_event_id")
      .notNull()
      .references(() => ledgerEvents.id, { onDelete: "restrict" }),
    bucket: text("bucket").notNull(),
    currencyCode: text("currency_code").notNull(),
    currencyScale: sqliteSmallInteger("currency_scale").notNull(),
    amountMinor: sqliteInt64("amount_minor").notNull(),
  },
  (table) => [
    check(
      "cash_ledger_entries_bucket",
      sql`${table.bucket} IN ('SETTLED', 'UNSETTLED_RECEIVABLE', 'UNSETTLED_PAYABLE')`,
    ),
    check(
      "cash_ledger_entries_currency",
      sql`(${table.currencyCode} = 'JPY' AND ${table.currencyScale} = 0) OR (${table.currencyCode} = 'USD' AND ${table.currencyScale} = 2)`,
    ),
    check("cash_ledger_entries_amount", sql`${table.amountMinor} <> 0`),
  ],
);
