import { createHash, randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import { withTransaction } from "@/db";
import {
  cashLedgerEntries,
  instruments,
  ledgerEvents,
  paperAccounts,
  positionLedgerEntries,
  sourceRecords,
  sources,
} from "@/db/schema";

export type PaperLedgerCashPosting = {
  bucket: "SETTLED" | "UNSETTLED_RECEIVABLE" | "UNSETTLED_PAYABLE";
  currencyCode: "JPY" | "USD";
  currencyScale: number;
  amountMinor: bigint;
};

export type PaperLedgerPositionPosting = {
  instrumentId: string;
  quantityShares: bigint;
};

export type PaperLedgerEvent = {
  id: string;
  sequenceNo: bigint;
  eventType: "ACCOUNT_OPENED" | "FILL" | "FEE";
  idempotencyKey: string;
  effectiveAtMs: bigint;
  recordedAtMs: bigint;
  ruleVersion: string;
  sourceRecordId: string | null;
  cashPostings: PaperLedgerCashPosting[];
  positionPostings: PaperLedgerPositionPosting[];
};

export type PaperLedgerProjection = {
  sequenceNo: bigint;
  cashBalances: Map<
    "JPY" | "USD",
    {
      settled: bigint;
      receivable: bigint;
      payable: bigint;
    }
  >;
  positions: Map<string, bigint>;
  feesByCurrency: Map<"JPY" | "USD", bigint>;
};

export type PaperLedgerEventInput =
  | {
      eventType: "FILL";
      idempotencyKey: string;
      effectiveAtMs: bigint;
      ruleVersion: "paper-fill-v1";
      sourceRecordId: string;
      cashPosting: PaperLedgerCashPosting;
      positionPosting: PaperLedgerPositionPosting;
    }
  | {
      eventType: "FEE";
      idempotencyKey: string;
      effectiveAtMs: bigint;
      ruleVersion: "paper-fee-v1";
      sourceRecordId?: string;
      cashPosting: PaperLedgerCashPosting;
    };

const accountOpeningRuleVersion = "account-opening-v1";

export function replayPaperLedger(
  events: PaperLedgerEvent[],
): PaperLedgerProjection {
  if (events.length === 0)
    throw new Error("paper_ledger_opening_event_missing");

  const cashBalances = new Map<
    "JPY" | "USD",
    { settled: bigint; receivable: bigint; payable: bigint }
  >();
  const positions = new Map<string, bigint>();
  const feesByCurrency = new Map<"JPY" | "USD", bigint>();
  const idempotencyKeys = new Set<string>();
  let recordedAtMs = BigInt(0);
  let effectiveAtMs: bigint | null = null;

  for (const [index, event] of events.entries()) {
    if (event.sequenceNo !== BigInt(index + 1))
      throw new Error("paper_ledger_sequence_invalid");
    if (
      !event.idempotencyKey.trim() ||
      idempotencyKeys.has(event.idempotencyKey)
    )
      throw new Error("paper_ledger_idempotency_key_invalid");
    if (
      !event.ruleVersion.trim() ||
      event.ruleVersion.length > 64 ||
      event.effectiveAtMs < BigInt(0) ||
      event.recordedAtMs < event.effectiveAtMs ||
      event.recordedAtMs < recordedAtMs ||
      (effectiveAtMs !== null && event.effectiveAtMs < effectiveAtMs)
    ) {
      throw new Error("paper_ledger_event_metadata_invalid");
    }
    idempotencyKeys.add(event.idempotencyKey);
    recordedAtMs = event.recordedAtMs;
    effectiveAtMs = event.effectiveAtMs;

    if (index === 0) {
      if (
        event.eventType !== "ACCOUNT_OPENED" ||
        event.ruleVersion !== accountOpeningRuleVersion ||
        event.sourceRecordId !== null ||
        event.cashPostings.length !== 1 ||
        event.positionPostings.length !== 0 ||
        event.cashPostings[0].bucket !== "SETTLED" ||
        event.cashPostings[0].currencyCode !== "JPY" ||
        event.cashPostings[0].currencyScale !== 0 ||
        event.cashPostings[0].amountMinor !== BigInt(1_000_000)
      ) {
        throw new Error("paper_ledger_opening_event_invalid");
      }
    } else if (event.eventType === "ACCOUNT_OPENED") {
      throw new Error("paper_ledger_duplicate_opening_event");
    } else if (event.eventType === "FILL") {
      if (
        event.ruleVersion !== "paper-fill-v1" ||
        !event.sourceRecordId ||
        event.cashPostings.length !== 1 ||
        event.positionPostings.length !== 1 ||
        event.cashPostings[0].bucket !== "SETTLED" ||
        event.cashPostings[0].amountMinor < BigInt(0) ===
          event.positionPostings[0].quantityShares < BigInt(0)
      ) {
        throw new Error("paper_ledger_fill_basis_invalid");
      }
    } else if (event.eventType === "FEE") {
      if (
        event.ruleVersion !== "paper-fee-v1" ||
        event.cashPostings.length !== 1 ||
        event.positionPostings.length !== 0 ||
        event.cashPostings[0].bucket !== "SETTLED" ||
        event.cashPostings[0].amountMinor >= BigInt(0)
      ) {
        throw new Error("paper_ledger_fee_basis_invalid");
      }
    } else {
      throw new Error("paper_ledger_event_type_unsupported");
    }

    for (const posting of event.cashPostings) {
      if (
        posting.amountMinor === BigInt(0) ||
        (posting.currencyCode === "JPY" && posting.currencyScale !== 0) ||
        (posting.currencyCode === "USD" && posting.currencyScale !== 2) ||
        (posting.bucket === "UNSETTLED_RECEIVABLE" &&
          posting.amountMinor <= BigInt(0)) ||
        (posting.bucket === "UNSETTLED_PAYABLE" &&
          posting.amountMinor >= BigInt(0))
      ) {
        throw new Error("paper_ledger_cash_posting_invalid");
      }

      const balance = cashBalances.get(posting.currencyCode) ?? {
        settled: BigInt(0),
        receivable: BigInt(0),
        payable: BigInt(0),
      };
      balance[
        posting.bucket === "SETTLED"
          ? "settled"
          : posting.bucket === "UNSETTLED_RECEIVABLE"
            ? "receivable"
            : "payable"
      ] += posting.amountMinor;
      if (
        balance.settled < BigInt(0) ||
        balance.settled + balance.payable < BigInt(0)
      ) {
        throw new Error("paper_ledger_negative_cash");
      }
      cashBalances.set(posting.currencyCode, balance);

      if (event.eventType === "FEE") {
        feesByCurrency.set(
          posting.currencyCode,
          (feesByCurrency.get(posting.currencyCode) ?? BigInt(0)) -
            posting.amountMinor,
        );
      }
    }

    for (const posting of event.positionPostings) {
      if (!posting.instrumentId || posting.quantityShares === BigInt(0))
        throw new Error("paper_ledger_position_posting_invalid");
      const quantity =
        (positions.get(posting.instrumentId) ?? BigInt(0)) +
        posting.quantityShares;
      if (quantity < BigInt(0)) throw new Error("paper_ledger_short_position");
      if (quantity === BigInt(0)) positions.delete(posting.instrumentId);
      else positions.set(posting.instrumentId, quantity);
    }
  }

  return {
    sequenceNo: events.at(-1)!.sequenceNo,
    cashBalances,
    positions,
    feesByCurrency,
  };
}

function loadPaperLedger(database: AppDatabase, accountId: string) {
  const rows = database.orm
    .select({
      id: ledgerEvents.id,
      sequenceNo: ledgerEvents.sequenceNo,
      eventType: ledgerEvents.eventType,
      idempotencyKey: ledgerEvents.idempotencyKey,
      effectiveAtMs: ledgerEvents.effectiveAtMs,
      recordedAtMs: ledgerEvents.recordedAtMs,
      ruleVersion: ledgerEvents.ruleVersion,
      sourceRecordId: ledgerEvents.sourceRecordId,
    })
    .from(ledgerEvents)
    .where(eq(ledgerEvents.accountId, accountId))
    .orderBy(asc(ledgerEvents.sequenceNo))
    .all();
  const eventIds = rows.map(({ id }) => id);
  const cashEntries = eventIds.length
    ? database.orm
        .select()
        .from(cashLedgerEntries)
        .where(inArray(cashLedgerEntries.ledgerEventId, eventIds))
        .orderBy(asc(cashLedgerEntries.id))
        .all()
    : [];
  const positionEntries = eventIds.length
    ? database.orm
        .select()
        .from(positionLedgerEntries)
        .where(inArray(positionLedgerEntries.ledgerEventId, eventIds))
        .orderBy(asc(positionLedgerEntries.id))
        .all()
    : [];
  const cashByEvent = new Map<string, PaperLedgerCashPosting[]>();
  const positionsByEvent = new Map<string, PaperLedgerPositionPosting[]>();

  for (const { ledgerEventId, ...posting } of cashEntries) {
    const entries = cashByEvent.get(ledgerEventId) ?? [];
    entries.push(parseCashPosting(posting));
    cashByEvent.set(ledgerEventId, entries);
  }
  for (const { ledgerEventId, ...posting } of positionEntries) {
    const entries = positionsByEvent.get(ledgerEventId) ?? [];
    entries.push(posting);
    positionsByEvent.set(ledgerEventId, entries);
  }

  return rows.map((event) => ({
    ...event,
    eventType: parseLedgerEventType(event.eventType),
    sourceRecordId: event.sourceRecordId ?? null,
    cashPostings: cashByEvent.get(event.id) ?? [],
    positionPostings: positionsByEvent.get(event.id) ?? [],
  }));
}

function parseCashPosting(input: {
  bucket: string;
  currencyCode: string;
  currencyScale: number;
  amountMinor: bigint;
}): PaperLedgerCashPosting {
  if (
    input.bucket !== "SETTLED" &&
    input.bucket !== "UNSETTLED_RECEIVABLE" &&
    input.bucket !== "UNSETTLED_PAYABLE"
  ) {
    throw new Error("paper_ledger_cash_posting_invalid");
  }
  if (input.currencyCode !== "JPY" && input.currencyCode !== "USD") {
    throw new Error("paper_ledger_cash_posting_invalid");
  }
  return {
    ...input,
    bucket: input.bucket,
    currencyCode: input.currencyCode,
    currencyScale: Number(input.currencyScale),
  };
}

function parseLedgerEventType(
  eventType: string,
): PaperLedgerEvent["eventType"] {
  if (
    eventType === "ACCOUNT_OPENED" ||
    eventType === "FILL" ||
    eventType === "FEE"
  ) {
    return eventType;
  }
  throw new Error("paper_ledger_event_type_unsupported");
}

function getLocalPaperAccount(database: AppDatabase) {
  return database.orm
    .select({ id: paperAccounts.id })
    .from(paperAccounts)
    .where(eq(paperAccounts.accountKey, "local-default"))
    .get();
}

function getSourceEvidence(database: AppDatabase, sourceRecordId: string) {
  return database.orm
    .select({
      recordType: sourceRecords.recordType,
      dataClass: sourceRecords.dataClass,
      authorityRole: sources.authorityRole,
      licenseStatus: sources.licenseStatus,
    })
    .from(sourceRecords)
    .innerJoin(sources, eq(sources.id, sourceRecords.sourceId))
    .where(eq(sourceRecords.id, sourceRecordId))
    .get();
}

function requireLicensedEvidence(
  database: AppDatabase,
  sourceRecordId: string,
  recordTypes: string[],
) {
  const evidence = getSourceEvidence(database, sourceRecordId);
  if (
    !evidence ||
    !recordTypes.includes(evidence.recordType) ||
    (evidence.dataClass !== "REAL" && evidence.dataClass !== "DELAYED") ||
    evidence.licenseStatus !== "VERIFIED" ||
    ![
      "REGULATORY_PRIMARY",
      "EXCHANGE_PRIMARY",
      "ISSUER_PRIMARY",
      "AUTHORIZED_VENDOR",
    ].includes(evidence.authorityRole)
  ) {
    throw new Error("paper_ledger_source_unverified");
  }
  return evidence;
}

function requireVerifiedInstrument(
  database: AppDatabase,
  instrumentId: string,
) {
  const instrument = database.orm
    .select()
    .from(instruments)
    .where(eq(instruments.id, instrumentId))
    .get();
  if (
    !instrument ||
    instrument.classificationStatus !== "VERIFIED" ||
    instrument.assetClass === "UNKNOWN" ||
    !instrument.classificationSourceRecordId
  ) {
    throw new Error("paper_ledger_instrument_unverified");
  }

  requireLicensedEvidence(database, instrument.classificationSourceRecordId, [
    "DISCLOSURE",
    "MARKET_QUOTE",
    "OTHER",
  ]);
  return instrument;
}

export function registerPaperInstrument(
  database: AppDatabase,
  input: {
    marketCode: "JP" | "US";
    assetClass: "COMMON_STOCK" | "NON_LEVERAGED_ETF";
    tradingUnit: bigint;
    classificationSourceRecordId: string;
  },
) {
  requireLicensedEvidence(database, input.classificationSourceRecordId, [
    "DISCLOSURE",
    "MARKET_QUOTE",
    "OTHER",
  ]);
  const instrument = {
    id: randomUUID(),
    marketCode: input.marketCode,
    assetClass: input.assetClass,
    quoteCurrencyCode: input.marketCode === "JP" ? "JPY" : "USD",
    tradingUnit: input.tradingUnit,
    exchangeTimeZone:
      input.marketCode === "JP" ? "Asia/Tokyo" : "America/New_York",
    classificationStatus: "VERIFIED",
    classificationSourceRecordId: input.classificationSourceRecordId,
    createdAtMs: BigInt(Date.now()),
  } as const;
  database.orm.insert(instruments).values(instrument).run();
  return instrument;
}

export function readPaperLedger(database: AppDatabase) {
  const account = getLocalPaperAccount(database);
  if (!account) return null;
  const events = loadPaperLedger(database, account.id);
  const projection = replayPaperLedger(events);
  return { account, events, projection };
}

export function appendPaperLedgerEvent(
  database: AppDatabase,
  input: PaperLedgerEventInput,
) {
  return withTransaction(database, () => {
    const account = getLocalPaperAccount(database);
    if (!account) throw new Error("paper_account_not_initialized");
    if (
      !input.idempotencyKey.trim() ||
      input.idempotencyKey.length > 200 ||
      input.effectiveAtMs < BigInt(0)
    ) {
      throw new Error("paper_ledger_event_metadata_invalid");
    }
    if (input.eventType === "FILL") {
      const evidence = requireLicensedEvidence(database, input.sourceRecordId, [
        "MARKET_QUOTE",
      ]);
      if (input.ruleVersion !== "paper-fill-v1")
        throw new Error("paper_ledger_fill_rule_unsupported");
      const instrument = requireVerifiedInstrument(
        database,
        input.positionPosting.instrumentId,
      );
      if (
        evidence.authorityRole !== "EXCHANGE_PRIMARY" &&
        evidence.authorityRole !== "AUTHORIZED_VENDOR"
      ) {
        throw new Error("paper_ledger_market_source_unverified");
      }
      if (
        input.cashPosting.currencyCode !== instrument.quoteCurrencyCode ||
        input.cashPosting.bucket !== "SETTLED"
      ) {
        throw new Error("paper_ledger_fill_currency_invalid");
      }
    } else {
      if (input.ruleVersion !== "paper-fee-v1")
        throw new Error("paper_ledger_fee_rule_unsupported");
      if (input.sourceRecordId) {
        requireLicensedEvidence(database, input.sourceRecordId, ["OTHER"]);
      }
    }

    const events = loadPaperLedger(database, account.id);
    if (events.some((event) => event.idempotencyKey === input.idempotencyKey))
      throw new Error("paper_ledger_idempotency_key_conflict");

    const recordedAtMs = BigInt(Date.now());
    if (input.effectiveAtMs > recordedAtMs)
      throw new Error("paper_ledger_event_time_in_future");
    const eventId = randomUUID();
    const sequenceNo = (events.at(-1)?.sequenceNo ?? BigInt(0)) + BigInt(1);
    const event: PaperLedgerEvent = {
      id: eventId,
      sequenceNo,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      effectiveAtMs: input.effectiveAtMs,
      recordedAtMs,
      ruleVersion: input.ruleVersion,
      sourceRecordId: input.sourceRecordId ?? null,
      cashPostings: [input.cashPosting],
      positionPostings:
        input.eventType === "FILL" ? [input.positionPosting] : [],
    };
    replayPaperLedger([...events, event]);

    database.orm
      .insert(ledgerEvents)
      .values({
        id: eventId,
        accountId: account.id,
        sequenceNo,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        effectiveAtMs: input.effectiveAtMs,
        recordedAtMs,
        ruleVersion: input.ruleVersion,
        sourceRecordId: input.sourceRecordId ?? null,
      })
      .run();
    database.orm
      .insert(cashLedgerEntries)
      .values({
        id: randomUUID(),
        ledgerEventId: eventId,
        ...input.cashPosting,
      })
      .run();
    if (input.eventType === "FILL") {
      database.orm
        .insert(positionLedgerEntries)
        .values({
          id: randomUUID(),
          ledgerEventId: eventId,
          ...input.positionPosting,
        })
        .run();
    }
    return event;
  });
}

export function paperLedgerInputHash(events: PaperLedgerEvent[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        events.map((event) => ({
          id: event.id,
          sequenceNo: event.sequenceNo.toString(),
          eventType: event.eventType,
          idempotencyKey: event.idempotencyKey,
          effectiveAtMs: event.effectiveAtMs.toString(),
          recordedAtMs: event.recordedAtMs.toString(),
          ruleVersion: event.ruleVersion,
          sourceRecordId: event.sourceRecordId,
          cashPostings: [...event.cashPostings]
            .sort((a, b) =>
              `${a.currencyCode}:${a.bucket}`.localeCompare(
                `${b.currencyCode}:${b.bucket}`,
              ),
            )
            .map((posting) => ({
              bucket: posting.bucket,
              currencyCode: posting.currencyCode,
              currencyScale: posting.currencyScale,
              amountMinor: posting.amountMinor.toString(),
            })),
          positionPostings: [...event.positionPostings]
            .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId))
            .map((posting) => ({
              instrumentId: posting.instrumentId,
              quantityShares: posting.quantityShares.toString(),
            })),
        })),
      ),
    )
    .digest("hex");
}
