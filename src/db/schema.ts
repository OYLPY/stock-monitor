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
