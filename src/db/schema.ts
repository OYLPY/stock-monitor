import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull(),
    publisher: text("publisher").notNull(),
    sourceType: text("source_type").notNull(),
    authorityRole: text("authority_role").notNull(),
    referenceUrl: text("reference_url"),
    licenseUrl: text("license_url"),
    licenseStatus: text("license_status").notNull(),
    credentialRequirement: text("credential_requirement").notNull(),
    registeredAtMs: sqliteInt64("registered_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("sources_source_key").on(table.sourceKey),
    check(
      "sources_source_type",
      sql`${table.sourceType} IN ('REGULATORY', 'EXCHANGE', 'ISSUER', 'NEWS', 'DATA_VENDOR', 'OTHER')`,
    ),
    check(
      "sources_authority_role",
      sql`${table.authorityRole} IN ('REGULATORY_PRIMARY', 'EXCHANGE_PRIMARY', 'ISSUER_PRIMARY', 'AUTHORIZED_VENDOR', 'SECONDARY', 'FIXTURE', 'UNKNOWN')`,
    ),
    check(
      "sources_license_status",
      sql`${table.licenseStatus} IN ('VERIFIED', 'NOT_VERIFIED', 'UNKNOWN')`,
    ),
    check(
      "sources_credential_requirement",
      sql`${table.credentialRequirement} IN ('REQUIRED', 'NOT_REQUIRED', 'UNKNOWN')`,
    ),
  ],
);

export const sourceRecords = sqliteTable(
  "source_records",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    recordKey: text("record_key").notNull(),
    recordType: text("record_type").notNull(),
    recordVersion: sqliteSmallInteger("record_version").notNull(),
    supersedesRecordId: text("supersedes_record_id").references(
      (): AnySQLiteColumn => sourceRecords.id,
      { onDelete: "restrict" },
    ),
    publishedAtMs: sqliteInt64("published_at_ms"),
    occurredAtMs: sqliteInt64("occurred_at_ms"),
    availableAtMs: sqliteInt64("available_at_ms"),
    collectedAtMs: sqliteInt64("collected_at_ms").notNull(),
    rawTimeText: text("raw_time_text"),
    sourceTimeZone: text("source_time_zone"),
    canonicalUrl: text("canonical_url"),
    contentHashSha256: text("content_hash_sha256").notNull(),
    dataClass: text("data_class").notNull(),
  },
  (table) => [
    uniqueIndex("source_records_identity_version").on(
      table.sourceId,
      table.recordKey,
      table.recordVersion,
    ),
    index("source_records_source_collected_at").on(
      table.sourceId,
      table.collectedAtMs,
    ),
    check("source_records_version", sql`${table.recordVersion} > 0`),
    check(
      "source_records_version_link",
      sql`(${table.recordVersion} = 1 AND ${table.supersedesRecordId} IS NULL) OR (${table.recordVersion} > 1 AND ${table.supersedesRecordId} IS NOT NULL)`,
    ),
    check(
      "source_records_record_type",
      sql`${table.recordType} IN ('MARKET_QUOTE', 'DISCLOSURE', 'NEWS', 'OTHER')`,
    ),
    check(
      "source_records_content_hash",
      sql`length(${table.contentHashSha256}) = 64 AND ${table.contentHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "source_records_data_class",
      sql`${table.dataClass} IN ('REAL', 'DELAYED', 'HISTORICAL', 'FIXTURE', 'NOT_VERIFIED')`,
    ),
  ],
);

export const marketPriceBars = sqliteTable(
  "market_price_bars",
  {
    id: text("id").primaryKey(),
    marketCode: text("market_code").notNull(),
    symbol: text("symbol").notNull(),
    tradingDate: text("trading_date").notNull(),
    openMantissa: sqliteInt64("open_mantissa").notNull(),
    highMantissa: sqliteInt64("high_mantissa").notNull(),
    lowMantissa: sqliteInt64("low_mantissa").notNull(),
    closeMantissa: sqliteInt64("close_mantissa").notNull(),
    priceScale: sqliteSmallInteger("price_scale").notNull(),
    volumeShares: sqliteInt64("volume_shares").notNull(),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    collectedAtMs: sqliteInt64("collected_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("market_price_bars_source_date").on(
      table.sourceRecordId,
      table.tradingDate,
    ),
    index("market_price_bars_market_symbol_date").on(
      table.marketCode,
      table.symbol,
      table.tradingDate,
      table.collectedAtMs,
    ),
    check("market_price_bars_market", sql`${table.marketCode} IN ('JP', 'US')`),
    check(
      "market_price_bars_symbol",
      sql`length(${table.symbol}) BETWEEN 1 AND 32`,
    ),
    check(
      "market_price_bars_date",
      sql`length(${table.tradingDate}) = 10 AND date(${table.tradingDate}) = ${table.tradingDate}`,
    ),
    check(
      "market_price_bars_prices",
      sql`${table.openMantissa} > 0 AND ${table.highMantissa} > 0 AND ${table.lowMantissa} > 0 AND ${table.closeMantissa} > 0 AND ${table.priceScale} BETWEEN 0 AND 8`,
    ),
    check(
      "market_price_bars_ohlc",
      sql`${table.highMantissa} >= ${table.openMantissa} AND ${table.highMantissa} >= ${table.closeMantissa} AND ${table.highMantissa} >= ${table.lowMantissa} AND ${table.lowMantissa} <= ${table.openMantissa} AND ${table.lowMantissa} <= ${table.closeMantissa}`,
    ),
    check("market_price_bars_volume", sql`${table.volumeShares} >= 0`),
  ],
);

export const instruments = sqliteTable(
  "instruments",
  {
    id: text("id").primaryKey(),
    marketCode: text("market_code").notNull(),
    assetClass: text("asset_class").notNull(),
    quoteCurrencyCode: text("quote_currency_code").notNull(),
    tradingUnit: sqliteInt64("trading_unit").notNull(),
    exchangeTimeZone: text("exchange_time_zone").notNull(),
    classificationStatus: text("classification_status").notNull(),
    classificationSourceRecordId: text(
      "classification_source_record_id",
    ).references(() => sourceRecords.id, { onDelete: "restrict" }),
    createdAtMs: sqliteInt64("created_at_ms").notNull(),
  },
  (table) => [
    check("instruments_market", sql`${table.marketCode} IN ('JP', 'US')`),
    check(
      "instruments_asset_class",
      sql`${table.assetClass} IN ('COMMON_STOCK', 'NON_LEVERAGED_ETF', 'UNKNOWN')`,
    ),
    check(
      "instruments_currency",
      sql`(${table.marketCode} = 'JP' AND ${table.quoteCurrencyCode} = 'JPY') OR (${table.marketCode} = 'US' AND ${table.quoteCurrencyCode} = 'USD')`,
    ),
    check("instruments_trading_unit", sql`${table.tradingUnit} > 0`),
    check(
      "instruments_exchange_time_zone",
      sql`(${table.marketCode} = 'JP' AND ${table.exchangeTimeZone} = 'Asia/Tokyo') OR (${table.marketCode} = 'US' AND ${table.exchangeTimeZone} = 'America/New_York')`,
    ),
    check(
      "instruments_classification_status",
      sql`${table.classificationStatus} IN ('VERIFIED', 'NOT_VERIFIED')`,
    ),
    check(
      "instruments_verified_classification",
      sql`${table.classificationStatus} <> 'VERIFIED' OR (${table.assetClass} <> 'UNKNOWN' AND ${table.classificationSourceRecordId} IS NOT NULL)`,
    ),
  ],
);

export const marketEvents = sqliteTable("market_events", {
  id: text("id").primaryKey(),
  createdAtMs: sqliteInt64("created_at_ms").notNull(),
});

export const marketEventRevisions = sqliteTable(
  "market_event_revisions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => marketEvents.id, { onDelete: "restrict" }),
    revisionNo: sqliteSmallInteger("revision_no").notNull(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    marketCode: text("market_code"),
    instrumentKey: text("instrument_key"),
    occurredAtMs: sqliteInt64("occurred_at_ms"),
    publishedAtMs: sqliteInt64("published_at_ms"),
    firstSeenAtMs: sqliteInt64("first_seen_at_ms").notNull(),
    importanceReason: text("importance_reason").notNull(),
    dataClass: text("data_class").notNull(),
    verificationLevel: text("verification_level").notNull(),
    verificationReason: text("verification_reason"),
    verificationRuleVersion: text("verification_rule_version"),
    primarySourceRecordId: text("primary_source_record_id").references(
      () => sourceRecords.id,
      { onDelete: "restrict" },
    ),
    fingerprintAlgorithmVersion: text(
      "fingerprint_algorithm_version",
    ).notNull(),
    fingerprintSha256: text("fingerprint_sha256").notNull(),
    recordedAtMs: sqliteInt64("recorded_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("market_event_revisions_event_version").on(
      table.eventId,
      table.revisionNo,
    ),
    check("market_event_revisions_version", sql`${table.revisionNo} > 0`),
    check(
      "market_event_revisions_market",
      sql`${table.marketCode} IS NULL OR ${table.marketCode} IN ('JP', 'US')`,
    ),
    check(
      "market_event_revisions_data_class",
      sql`${table.dataClass} IN ('REAL', 'DELAYED', 'HISTORICAL', 'FIXTURE', 'NOT_VERIFIED')`,
    ),
    check(
      "market_event_revisions_verification_level",
      sql`${table.verificationLevel} IN ('VERIFIED', 'PARTIAL', 'NOT_VERIFIED', 'DEMO_ONLY')`,
    ),
    check(
      "market_event_revisions_verified_source",
      sql`${table.verificationLevel} <> 'VERIFIED' OR (${table.primarySourceRecordId} IS NOT NULL AND ${table.verificationRuleVersion} IS NOT NULL AND ${table.dataClass} <> 'FIXTURE' AND ${table.dataClass} <> 'NOT_VERIFIED')`,
    ),
    check(
      "market_event_revisions_fixture_level",
      sql`${table.dataClass} <> 'FIXTURE' OR ${table.verificationLevel} = 'DEMO_ONLY'`,
    ),
    check(
      "market_event_revisions_fingerprint",
      sql`length(${table.fingerprintSha256}) = 64 AND ${table.fingerprintSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const marketEventEvidence = sqliteTable(
  "market_event_evidence",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => marketEventRevisions.id, { onDelete: "restrict" }),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    relation: text("relation").notNull(),
    linkedAtMs: sqliteInt64("linked_at_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.sourceRecordId] }),
    check(
      "market_event_evidence_relation",
      sql`${table.relation} IN ('SUPPORTS', 'CONTRADICTS', 'CONTEXT')`,
    ),
  ],
);

export const taskRuns = sqliteTable(
  "task_runs",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    inputHashSha256: text("input_hash_sha256").notNull(),
    runType: text("run_type").notNull(),
    inputJson: text("input_json").notNull(),
    timeZone: text("time_zone").notNull(),
    scheduledLocalAt: text("scheduled_local_at").notNull(),
    scheduledAtMs: sqliteInt64("scheduled_at_ms").notNull(),
    timeoutMs: sqliteSmallInteger("timeout_ms").notNull(),
    executionStatus: text("execution_status").notNull(),
    attemptCount: sqliteSmallInteger("attempt_count").notNull().default(0),
    nextAttemptAtMs: sqliteInt64("next_attempt_at_ms").notNull(),
    leaseOwner: text("lease_owner"),
    leaseUntilMs: sqliteInt64("lease_until_ms"),
    fencingGeneration: sqliteSmallInteger("fencing_generation")
      .notNull()
      .default(0),
    cancellationRequestedAtMs: sqliteInt64("cancellation_requested_at_ms"),
    resultCode: text("result_code"),
    errorCode: text("error_code"),
    createdAtMs: sqliteInt64("created_at_ms").notNull(),
    startedAtMs: sqliteInt64("started_at_ms"),
    finishedAtMs: sqliteInt64("finished_at_ms"),
  },
  (table) => [
    uniqueIndex("task_runs_idempotency_key").on(table.idempotencyKey),
    index("task_runs_due").on(
      table.executionStatus,
      table.nextAttemptAtMs,
      table.createdAtMs,
    ),
    check(
      "task_runs_input_hash",
      sql`length(${table.inputHashSha256}) = 64 AND ${table.inputHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("task_runs_input_json", sql`json_valid(${table.inputJson})`),
    check("task_runs_timezone", sql`length(${table.timeZone}) > 0`),
    check("task_runs_timeout", sql`${table.timeoutMs} BETWEEN 1 AND 86400000`),
    check(
      "task_runs_status",
      sql`${table.executionStatus} IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED')`,
    ),
    check(
      "task_runs_attempt_count",
      sql`${table.attemptCount} BETWEEN 0 AND 3`,
    ),
    check("task_runs_fencing_generation", sql`${table.fencingGeneration} >= 0`),
    check(
      "task_runs_lease",
      sql`(${table.executionStatus} = 'RUNNING' AND ${table.leaseOwner} IS NOT NULL AND ${table.leaseUntilMs} IS NOT NULL) OR (${table.executionStatus} <> 'RUNNING' AND ${table.leaseOwner} IS NULL AND ${table.leaseUntilMs} IS NULL)`,
    ),
    check(
      "task_runs_finished",
      sql`(${table.executionStatus} IN ('PENDING', 'RUNNING') AND ${table.finishedAtMs} IS NULL) OR (${table.executionStatus} IN ('DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED') AND ${table.finishedAtMs} IS NOT NULL)`,
    ),
  ],
);

export const researchReports = sqliteTable(
  "research_reports",
  {
    taskRunId: text("task_run_id")
      .primaryKey()
      .references(() => taskRuns.id, { onDelete: "restrict" }),
    reportType: text("report_type").notNull(),
    verificationLevel: text("verification_level").notNull(),
    contentSchemaVersion: sqliteSmallInteger("content_schema_version")
      .notNull()
      .default(1),
    reportJson: text("report_json").notNull(),
    archivedAtMs: sqliteInt64("archived_at_ms").notNull(),
  },
  (table) => [
    index("research_reports_archived_at").on(table.archivedAtMs),
    check(
      "research_reports_type",
      sql`${table.reportType} IN ('MORNING', 'ANOMALY', 'DAILY_AUDIT', 'WEEKLY_AUDIT')`,
    ),
    check(
      "research_reports_verification",
      sql`${table.verificationLevel} IN ('VERIFIED', 'PARTIAL', 'NOT_VERIFIED', 'DEMO_ONLY')`,
    ),
    check("research_reports_json", sql`json_valid(${table.reportJson})`),
  ],
);

export const taskRunAttempts = sqliteTable(
  "task_run_attempts",
  {
    taskRunId: text("task_run_id")
      .notNull()
      .references(() => taskRuns.id, { onDelete: "restrict" }),
    attemptNo: sqliteSmallInteger("attempt_no").notNull(),
    workerId: text("worker_id").notNull(),
    executionStatus: text("execution_status").notNull(),
    startedAtMs: sqliteInt64("started_at_ms").notNull(),
    finishedAtMs: sqliteInt64("finished_at_ms"),
    errorCode: text("error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.taskRunId, table.attemptNo] }),
    check("task_run_attempts_number", sql`${table.attemptNo} BETWEEN 1 AND 3`),
    check(
      "task_run_attempts_status",
      sql`${table.executionStatus} IN ('RUNNING', 'DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED', 'ABANDONED')`,
    ),
    check(
      "task_run_attempts_finished",
      sql`(${table.executionStatus} = 'RUNNING' AND ${table.finishedAtMs} IS NULL) OR (${table.executionStatus} <> 'RUNNING' AND ${table.finishedAtMs} IS NOT NULL)`,
    ),
  ],
);

export const taskRunEvents = sqliteTable(
  "task_run_events",
  {
    id: text("id").primaryKey(),
    taskRunId: text("task_run_id").references(() => taskRuns.id, {
      onDelete: "restrict",
    }),
    workerId: text("worker_id"),
    eventType: text("event_type").notNull(),
    occurredAtMs: sqliteInt64("occurred_at_ms").notNull(),
    detailsJson: text("details_json").notNull(),
  },
  (table) => [
    index("task_run_events_task_time").on(table.taskRunId, table.occurredAtMs),
    check("task_run_events_details", sql`json_valid(${table.detailsJson})`),
    check(
      "task_run_events_type",
      sql`${table.eventType} IN ('TASK_QUEUED', 'TASK_CLAIMED', 'TASK_RECLAIMED', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_BLOCKED_EXTERNAL', 'TASK_CANCEL_REQUESTED', 'TASK_CANCELLED', 'TASK_SKIPPED', 'TASK_TIMED_OUT', 'TASK_ABANDONED', 'WORKER_LOCK_ACQUIRED', 'WORKER_LOCK_RELEASED', 'WORKER_LOCK_LOST')`,
    ),
  ],
);

export const workerState = sqliteTable(
  "worker_state",
  {
    singletonId: sqliteSmallInteger("singleton_id").primaryKey(),
    ownerId: text("owner_id"),
    processId: sqliteSmallInteger("process_id"),
    acquiredAtMs: sqliteInt64("acquired_at_ms"),
    heartbeatAtMs: sqliteInt64("heartbeat_at_ms"),
    leaseUntilMs: sqliteInt64("lease_until_ms"),
  },
  (table) => [
    check("worker_state_singleton", sql`${table.singletonId} = 1`),
    check(
      "worker_state_lock",
      sql`(${table.ownerId} IS NULL AND ${table.processId} IS NULL AND ${table.acquiredAtMs} IS NULL AND ${table.heartbeatAtMs} IS NULL AND ${table.leaseUntilMs} IS NULL) OR (${table.ownerId} IS NOT NULL AND ${table.processId} > 0 AND ${table.acquiredAtMs} IS NOT NULL AND ${table.heartbeatAtMs} IS NOT NULL AND ${table.leaseUntilMs} IS NOT NULL)`,
    ),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    sequenceNo: sqliteInt64("sequence_no").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    payloadHashSha256: text("payload_hash_sha256").notNull(),
    previousHashSha256: text("previous_hash_sha256"),
    eventHashSha256: text("event_hash_sha256").notNull(),
    recordedAtMs: sqliteInt64("recorded_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("audit_events_sequence").on(table.sequenceNo),
    check("audit_events_sequence_positive", sql`${table.sequenceNo} > 0`),
    check(
      "audit_events_payload_hash",
      sql`length(${table.payloadHashSha256}) = 64 AND ${table.payloadHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "audit_events_hash",
      sql`length(${table.eventHashSha256}) = 64 AND ${table.eventHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "audit_events_previous_hash",
      sql`${table.previousHashSha256} IS NULL OR (length(${table.previousHashSha256}) = 64 AND ${table.previousHashSha256} NOT GLOB '*[^0-9a-f]*')`,
    ),
  ],
);

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
    ruleVersion: text("rule_version").notNull().default("account-opening-v1"),
    sourceRecordId: text("source_record_id").references(
      () => sourceRecords.id,
      { onDelete: "restrict" },
    ),
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

export const positionLedgerEntries = sqliteTable(
  "position_ledger_entries",
  {
    id: text("id").primaryKey(),
    ledgerEventId: text("ledger_event_id")
      .notNull()
      .references(() => ledgerEvents.id, { onDelete: "restrict" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    quantityShares: sqliteInt64("quantity_shares").notNull(),
  },
  (table) => [
    index("position_ledger_entries_instrument").on(table.instrumentId),
    check(
      "position_ledger_entries_quantity",
      sql`${table.quantityShares} <> 0`,
    ),
  ],
);

export const equityValuations = sqliteTable(
  "equity_valuations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "restrict" }),
    asOfMs: sqliteInt64("as_of_ms").notNull(),
    ledgerSequenceNo: sqliteInt64("ledger_sequence_no").notNull(),
    inputHashSha256: text("input_hash_sha256").notNull(),
    status: text("status").notNull(),
    equityMinor: sqliteInt64("equity_minor"),
    currencyCode: text("currency_code").notNull(),
    currencyScale: sqliteSmallInteger("currency_scale").notNull(),
    unresolvedReason: text("unresolved_reason"),
    ruleVersion: text("rule_version").notNull(),
    createdAtMs: sqliteInt64("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("equity_valuations_input").on(
      table.accountId,
      table.asOfMs,
      table.inputHashSha256,
      table.ruleVersion,
    ),
    index("equity_valuations_account_sequence").on(
      table.accountId,
      table.ledgerSequenceNo,
    ),
    check("equity_valuations_sequence", sql`${table.ledgerSequenceNo} >= 0`),
    check(
      "equity_valuations_input_hash",
      sql`length(${table.inputHashSha256}) = 64 AND ${table.inputHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "equity_valuations_currency",
      sql`${table.currencyCode} = 'JPY' AND ${table.currencyScale} = 0`,
    ),
    check(
      "equity_valuations_status",
      sql`(${table.status} = 'VERIFIED' AND ${table.equityMinor} IS NOT NULL AND ${table.unresolvedReason} IS NULL) OR (${table.status} = 'UNRESOLVED' AND ${table.equityMinor} IS NULL AND ${table.unresolvedReason} IS NOT NULL)`,
    ),
    check(
      "equity_valuations_rule_version",
      sql`length(${table.ruleVersion}) BETWEEN 1 AND 64`,
    ),
  ],
);

export const equityValuationEvidence = sqliteTable(
  "equity_valuation_evidence",
  {
    id: text("id").primaryKey(),
    valuationId: text("valuation_id")
      .notNull()
      .references(() => equityValuations.id, { onDelete: "restrict" }),
    ledgerEventId: text("ledger_event_id")
      .notNull()
      .references(() => ledgerEvents.id, { onDelete: "restrict" }),
    sourceRecordId: text("source_record_id").references(
      () => sourceRecords.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("equity_valuation_evidence_event").on(
      table.valuationId,
      table.ledgerEventId,
    ),
  ],
);

export const equityValuationMarketEvidence = sqliteTable(
  "equity_valuation_market_evidence",
  {
    id: text("id").primaryKey(),
    valuationId: text("valuation_id")
      .notNull()
      .references(() => equityValuations.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    instrumentId: text("instrument_id").references(() => instruments.id, {
      onDelete: "restrict",
    }),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    contentHashSha256: text("content_hash_sha256").notNull(),
    content: text("content").notNull(),
  },
  (table) => [
    index("equity_valuation_market_evidence_valuation").on(
      table.valuationId,
      table.role,
      table.instrumentId,
    ),
    check(
      "equity_valuation_market_evidence_role",
      sql`(${table.role} = 'POSITION_QUOTE' AND ${table.instrumentId} IS NOT NULL) OR (${table.role} = 'FX_RATE' AND ${table.instrumentId} IS NULL)`,
    ),
    check(
      "equity_valuation_market_evidence_hash",
      sql`length(${table.contentHashSha256}) = 64 AND ${table.contentHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "equity_valuation_market_evidence_content",
      sql`json_valid(${table.content})`,
    ),
  ],
);

export const paperPlans = sqliteTable("paper_plans", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  createdAtMs: sqliteInt64("created_at_ms").notNull(),
});

export const paperPlanVersions = sqliteTable(
  "paper_plan_versions",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => paperPlans.id, { onDelete: "restrict" }),
    versionNo: sqliteInt64("version_no").notNull(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    requestedQuantityShares: sqliteInt64("requested_quantity_shares").notNull(),
    candidateSnapshotJson: text("candidate_snapshot_json").notNull(),
    inputSnapshotJson: text("input_snapshot_json").notNull(),
    planHashSha256: text("plan_hash_sha256").notNull(),
    createdAtMs: sqliteInt64("created_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("paper_plan_versions_plan_number").on(
      table.planId,
      table.versionNo,
    ),
    index("paper_plan_versions_instrument_time").on(
      table.instrumentId,
      table.createdAtMs,
    ),
    check("paper_plan_versions_number", sql`${table.versionNo} > 0`),
    check(
      "paper_plan_versions_quantity",
      sql`${table.requestedQuantityShares} > 0`,
    ),
    check(
      "paper_plan_versions_candidate_json",
      sql`json_valid(${table.candidateSnapshotJson})`,
    ),
    check(
      "paper_plan_versions_input_json",
      sql`json_valid(${table.inputSnapshotJson})`,
    ),
    check(
      "paper_plan_versions_hash",
      sql`length(${table.planHashSha256}) = 64 AND ${table.planHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const planInputEvidence = sqliteTable(
  "plan_input_evidence",
  {
    id: text("id").primaryKey(),
    planVersionId: text("plan_version_id")
      .notNull()
      .references(() => paperPlanVersions.id, { onDelete: "restrict" }),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    contentHashSha256: text("content_hash_sha256").notNull(),
  },
  (table) => [
    uniqueIndex("plan_input_evidence_reference").on(
      table.planVersionId,
      table.role,
      table.sourceRecordId,
    ),
    check(
      "plan_input_evidence_role",
      sql`${table.role} IN ('CANDIDATE', 'CLASSIFICATION', 'QUOTE', 'RISK_MODEL', 'FX')`,
    ),
    check(
      "plan_input_evidence_hash",
      sql`length(${table.contentHashSha256}) = 64 AND ${table.contentHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const riskDecisions = sqliteTable(
  "risk_decisions",
  {
    id: text("id").primaryKey(),
    planVersionId: text("plan_version_id")
      .notNull()
      .references(() => paperPlanVersions.id, { onDelete: "restrict" }),
    decisionNo: sqliteInt64("decision_no").notNull(),
    planHashSha256: text("plan_hash_sha256").notNull(),
    status: text("status").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    requestedQuantityShares: sqliteInt64("requested_quantity_shares").notNull(),
    maxAllowedQuantityShares: sqliteInt64("max_allowed_quantity_shares"),
    equityMinor: sqliteInt64("equity_minor"),
    riskBudgetMinor: sqliteInt64("risk_budget_minor"),
    plannedLossJpyMinor: sqliteInt64("planned_loss_jpy_minor"),
    availableCashJson: text("available_cash_json").notNull(),
    calculationJson: text("calculation_json").notNull(),
    inputHashSha256: text("input_hash_sha256").notNull(),
    ruleVersion: text("rule_version").notNull(),
    decidedAtMs: sqliteInt64("decided_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("risk_decisions_version_number").on(
      table.planVersionId,
      table.decisionNo,
    ),
    index("risk_decisions_version_time").on(
      table.planVersionId,
      table.decidedAtMs,
    ),
    check("risk_decisions_number", sql`${table.decisionNo} > 0`),
    check(
      "risk_decisions_status",
      sql`${table.status} IN ('PASS', 'REJECT', 'UNRESOLVED')`,
    ),
    check(
      "risk_decisions_plan_hash",
      sql`length(${table.planHashSha256}) = 64 AND ${table.planHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "risk_decisions_input_hash",
      sql`length(${table.inputHashSha256}) = 64 AND ${table.inputHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "risk_decisions_reasons_json",
      sql`json_valid(${table.reasonCodesJson}) AND json_type(${table.reasonCodesJson}) = 'array'`,
    ),
    check(
      "risk_decisions_cash_json",
      sql`json_valid(${table.availableCashJson}) AND json_type(${table.availableCashJson}) = 'object'`,
    ),
    check(
      "risk_decisions_calculation_json",
      sql`json_valid(${table.calculationJson}) AND json_type(${table.calculationJson}) = 'object'`,
    ),
    check(
      "risk_decisions_requested_quantity",
      sql`${table.requestedQuantityShares} > 0`,
    ),
    check(
      "risk_decisions_max_quantity",
      sql`${table.maxAllowedQuantityShares} IS NULL OR ${table.maxAllowedQuantityShares} >= 0`,
    ),
    check(
      "risk_decisions_money",
      sql`(${table.riskBudgetMinor} IS NULL OR ${table.riskBudgetMinor} >= 0) AND (${table.plannedLossJpyMinor} IS NULL OR ${table.plannedLossJpyMinor} >= 0)`,
    ),
    check(
      "risk_decisions_rule_version",
      sql`length(${table.ruleVersion}) BETWEEN 1 AND 64`,
    ),
  ],
);

export const planApprovals = sqliteTable(
  "plan_approvals",
  {
    id: text("id").primaryKey(),
    planVersionId: text("plan_version_id")
      .notNull()
      .unique()
      .references(() => paperPlanVersions.id, { onDelete: "restrict" }),
    planHashSha256: text("plan_hash_sha256").notNull(),
    riskDecisionId: text("risk_decision_id")
      .notNull()
      .unique()
      .references(() => riskDecisions.id, { onDelete: "restrict" }),
    approvedAtMs: sqliteInt64("approved_at_ms").notNull(),
  },
  (table) => [
    check(
      "plan_approvals_hash",
      sql`length(${table.planHashSha256}) = 64 AND ${table.planHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
  ],
);

export const paperOrders = sqliteTable(
  "paper_orders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "restrict" }),
    planVersionId: text("plan_version_id")
      .notNull()
      .unique()
      .references(() => paperPlanVersions.id, { onDelete: "restrict" }),
    planApprovalId: text("plan_approval_id")
      .notNull()
      .unique()
      .references(() => planApprovals.id, { onDelete: "restrict" }),
    planHashSha256: text("plan_hash_sha256").notNull(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    requestedQuantityShares: sqliteInt64("requested_quantity_shares").notNull(),
    filledQuantityShares: sqliteInt64("filled_quantity_shares")
      .notNull()
      .default(sql`0`),
    currencyCode: text("currency_code").notNull(),
    reservedAmountMinor: sqliteInt64("reserved_amount_minor")
      .notNull()
      .default(sql`0`),
    feesChargedMinor: sqliteInt64("fees_charged_minor")
      .notNull()
      .default(sql`0`),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reasonCode: text("reason_code"),
    createdAtMs: sqliteInt64("created_at_ms").notNull(),
    updatedAtMs: sqliteInt64("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("paper_orders_account_idempotency").on(
      table.accountId,
      table.idempotencyKey,
    ),
    index("paper_orders_account_status").on(table.accountId, table.status),
    check(
      "paper_orders_plan_hash",
      sql`length(${table.planHashSha256}) = 64 AND ${table.planHashSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "paper_orders_quantity",
      sql`${table.requestedQuantityShares} > 0 AND ${table.filledQuantityShares} >= 0 AND ${table.filledQuantityShares} <= ${table.requestedQuantityShares}`,
    ),
    check(
      "paper_orders_currency",
      sql`${table.currencyCode} IN ('JPY', 'USD')`,
    ),
    check(
      "paper_orders_reserve",
      sql`${table.reservedAmountMinor} >= 0 AND ${table.feesChargedMinor} >= 0`,
    ),
    check(
      "paper_orders_status",
      sql`${table.status} IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED')`,
    ),
    check(
      "paper_orders_idempotency_key",
      sql`length(trim(${table.idempotencyKey})) BETWEEN 1 AND 200`,
    ),
  ],
);

export const paperOrderEvents = sqliteTable(
  "paper_order_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => paperOrders.id, { onDelete: "restrict" }),
    sequenceNo: sqliteInt64("sequence_no").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    effectiveAtMs: sqliteInt64("effective_at_ms").notNull(),
    recordedAtMs: sqliteInt64("recorded_at_ms").notNull(),
    reservedBeforeMinor: sqliteInt64("reserved_before_minor").notNull(),
    reservedAfterMinor: sqliteInt64("reserved_after_minor").notNull(),
    filledQuantityShares: sqliteInt64("filled_quantity_shares").notNull(),
    reasonCode: text("reason_code"),
    ledgerEventId: text("ledger_event_id").references(() => ledgerEvents.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    uniqueIndex("paper_order_events_order_sequence").on(
      table.orderId,
      table.sequenceNo,
    ),
    uniqueIndex("paper_order_events_order_idempotency").on(
      table.orderId,
      table.idempotencyKey,
    ),
    check("paper_order_events_sequence", sql`${table.sequenceNo} > 0`),
    check(
      "paper_order_events_type",
      sql`${table.eventType} IN ('SUBMITTED', 'PARTIAL_FILL', 'FILL', 'EXECUTION_REJECTED', 'CANCELED', 'EXPIRED', 'REJECTED')`,
    ),
    check(
      "paper_order_events_status",
      sql`${table.toStatus} IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED') AND (${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'))`,
    ),
    check(
      "paper_order_events_time",
      sql`${table.effectiveAtMs} >= 0 AND ${table.recordedAtMs} >= ${table.effectiveAtMs}`,
    ),
    check(
      "paper_order_events_reserve",
      sql`${table.reservedBeforeMinor} >= 0 AND ${table.reservedAfterMinor} >= 0 AND ${table.filledQuantityShares} >= 0`,
    ),
    check(
      "paper_order_events_ledger",
      sql`(${table.eventType} IN ('PARTIAL_FILL', 'FILL') AND ${table.ledgerEventId} IS NOT NULL) OR (${table.eventType} NOT IN ('PARTIAL_FILL', 'FILL') AND ${table.ledgerEventId} IS NULL)`,
    ),
  ],
);

export const paperFills = sqliteTable(
  "paper_fills",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => paperOrders.id, { onDelete: "restrict" }),
    fillKey: text("fill_key").notNull(),
    ledgerEventId: text("ledger_event_id")
      .notNull()
      .unique()
      .references(() => ledgerEvents.id, { onDelete: "restrict" }),
    feeLedgerEventId: text("fee_ledger_event_id")
      .unique()
      .references(() => ledgerEvents.id, { onDelete: "restrict" }),
    quantityShares: sqliteInt64("quantity_shares").notNull(),
    priceMantissa: sqliteInt64("price_mantissa").notNull(),
    priceScale: sqliteSmallInteger("price_scale").notNull(),
    currencyCode: text("currency_code").notNull(),
    feeMinor: sqliteInt64("fee_minor").notNull(),
    executionDataClass: text("execution_data_class").notNull(),
    quoteRecordId: text("quote_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    fxSourceRecordId: text("fx_source_record_id").references(
      () => sourceRecords.id,
      { onDelete: "restrict" },
    ),
    fxRate: text("fx_rate"),
    marketAtMs: sqliteInt64("market_at_ms").notNull(),
    executedAtMs: sqliteInt64("executed_at_ms").notNull(),
    settlementDate: text("settlement_date").notNull(),
    settlementRuleVersion: text("settlement_rule_version").notNull(),
    costModelVersion: text("cost_model_version").notNull(),
    matchingRuleVersion: text("matching_rule_version").notNull(),
  },
  (table) => [
    uniqueIndex("paper_fills_order_key").on(table.orderId, table.fillKey),
    index("paper_fills_quote_record").on(table.quoteRecordId),
    check("paper_fills_quantity", sql`${table.quantityShares} > 0`),
    check(
      "paper_fills_price",
      sql`${table.priceMantissa} > 0 AND ${table.priceScale} BETWEEN 0 AND 8`,
    ),
    check("paper_fills_currency", sql`${table.currencyCode} IN ('JPY', 'USD')`),
    check("paper_fills_fee", sql`${table.feeMinor} >= 0`),
    check(
      "paper_fills_fee_ledger",
      sql`(${table.feeMinor} = 0 AND ${table.feeLedgerEventId} IS NULL) OR (${table.feeMinor} > 0 AND ${table.feeLedgerEventId} IS NOT NULL)`,
    ),
    check("paper_fills_data_class", sql`${table.executionDataClass} = 'REAL'`),
    check(
      "paper_fills_time",
      sql`${table.marketAtMs} >= 0 AND ${table.executedAtMs} >= ${table.marketAtMs} AND length(${table.settlementDate}) = 10`,
    ),
    check(
      "paper_fills_fx",
      sql`(${table.fxSourceRecordId} IS NULL AND ${table.fxRate} IS NULL) OR (${table.fxSourceRecordId} IS NOT NULL AND ${table.fxRate} IS NOT NULL)`,
    ),
    check(
      "paper_fills_rule_versions",
      sql`length(${table.costModelVersion}) BETWEEN 1 AND 64 AND length(${table.matchingRuleVersion}) BETWEEN 1 AND 64 AND length(${table.settlementRuleVersion}) BETWEEN 1 AND 64`,
    ),
  ],
);
