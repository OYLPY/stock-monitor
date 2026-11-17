import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import { createPaperEquitySnapshot } from "@/features/risk/drawdown";
import { initializeDefaultPaperAccount } from "@/db/paper-account-repository";
import {
  cashLedgerEntries,
  equityValuationEvidence,
  equityValuationMarketEvidence,
  equityValuations,
  instruments,
  ledgerEvents,
  paperAccounts,
  positionLedgerEntries,
  sourceRecords,
  sources,
} from "@/db/schema";
import {
  appendPaperLedgerEvent,
  readPaperLedger,
  registerPaperInstrument,
  replayPaperLedger,
  type PaperLedgerEvent,
} from "./ledger";

function trustedMarketRecord(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
  recordType: "DISCLOSURE" | "MARKET_QUOTE",
  content: string,
  occurredAtMs: number,
) {
  const sourceId = randomUUID();
  const sourceRecordId = randomUUID();
  database.orm
    .insert(sources)
    .values({
      id: sourceId,
      sourceKey: `test-source-${randomUUID()}`,
      publisher: "Test exchange",
      sourceType: "EXCHANGE",
      authorityRole: "EXCHANGE_PRIMARY",
      referenceUrl: "https://example.com/source",
      licenseUrl: "https://example.com/license",
      licenseStatus: "VERIFIED",
      credentialRequirement: "NOT_REQUIRED",
      registeredAtMs: BigInt(occurredAtMs),
    })
    .run();
  database.orm
    .insert(sourceRecords)
    .values({
      id: sourceRecordId,
      sourceId,
      recordKey: `test-record-${randomUUID()}`,
      recordType,
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: null,
      occurredAtMs: BigInt(occurredAtMs),
      availableAtMs: null,
      collectedAtMs: BigInt(Date.now()),
      rawTimeText: null,
      sourceTimeZone: "Asia/Tokyo",
      canonicalUrl: null,
      contentHashSha256: createHash("sha256").update(content).digest("hex"),
      dataClass: "REAL",
    })
    .run();
  return sourceRecordId;
}

function openingEvent(): PaperLedgerEvent {
  return {
    id: "opening",
    sequenceNo: BigInt(1),
    eventType: "ACCOUNT_OPENED",
    idempotencyKey: "account-opening:v1",
    effectiveAtMs: BigInt(100),
    recordedAtMs: BigInt(100),
    ruleVersion: "account-opening-v1",
    sourceRecordId: null,
    cashPostings: [
      {
        bucket: "SETTLED",
        currencyCode: "JPY",
        currencyScale: 0,
        amountMinor: BigInt(1_000_000),
      },
    ],
    positionPostings: [],
  };
}

function fixtureQuote(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
) {
  const sourceId = randomUUID();
  const sourceRecordId = randomUUID();
  database.orm
    .insert(sources)
    .values({
      id: sourceId,
      sourceKey: "fixture-market-quote",
      publisher: "Test fixture",
      sourceType: "EXCHANGE",
      authorityRole: "EXCHANGE_PRIMARY",
      referenceUrl: null,
      licenseUrl: null,
      licenseStatus: "VERIFIED",
      credentialRequirement: "NOT_REQUIRED",
      registeredAtMs: BigInt(100),
    })
    .run();
  database.orm
    .insert(sourceRecords)
    .values({
      id: sourceRecordId,
      sourceId,
      recordKey: "fixture:quote",
      recordType: "MARKET_QUOTE",
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: null,
      occurredAtMs: BigInt(100),
      availableAtMs: null,
      collectedAtMs: BigInt(100),
      rawTimeText: null,
      sourceTimeZone: "Asia/Tokyo",
      canonicalUrl: null,
      contentHashSha256: "f".repeat(64),
      dataClass: "FIXTURE",
    })
    .run();
  return sourceRecordId;
}

describe("paper ledger", () => {
  it("opens with only the configured cash and does not invent fills", async () => {
    const fixture = await createTestDatabase();
    try {
      expect(readPaperLedger(fixture.database)).toBeNull();
      initializeDefaultPaperAccount(fixture.database);

      const ledger = readPaperLedger(fixture.database);

      expect(ledger?.events).toHaveLength(1);
      expect(ledger?.events[0]).toMatchObject({
        eventType: "ACCOUNT_OPENED",
        sourceRecordId: null,
        ruleVersion: "account-opening-v1",
      });
      expect(ledger?.projection.cashBalances.get("JPY")?.settled).toBe(
        BigInt(1_000_000),
      );
      expect(ledger?.projection.positions.size).toBe(0);
      expect(
        fixture.database.orm.select().from(paperAccounts).all(),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("replays fills and fees exactly and rejects negative cash or short positions", () => {
    const opening = openingEvent();
    const fill: PaperLedgerEvent = {
      ...opening,
      id: "fill",
      sequenceNo: BigInt(2),
      eventType: "FILL",
      idempotencyKey: "fill-1",
      ruleVersion: "paper-fill-v1",
      sourceRecordId: "quote-1",
      cashPostings: [
        {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-5_000),
        },
      ],
      positionPostings: [
        { instrumentId: "instrument-1", quantityShares: BigInt(2) },
      ],
    };
    const fee: PaperLedgerEvent = {
      ...opening,
      id: "fee",
      sequenceNo: BigInt(3),
      eventType: "FEE",
      idempotencyKey: "fee-1",
      ruleVersion: "paper-fee-v1",
      sourceRecordId: null,
      cashPostings: [
        {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-25),
        },
      ],
      positionPostings: [],
    };
    const projection = replayPaperLedger([opening, fill, fee]);

    expect(projection.cashBalances.get("JPY")?.settled).toBe(BigInt(994_975));
    expect(projection.positions.get("instrument-1")).toBe(BigInt(2));
    expect(projection.feesByCurrency.get("JPY")).toBe(BigInt(25));

    const overspend = {
      ...fill,
      cashPostings: [
        { ...fill.cashPostings[0], amountMinor: BigInt(-1_000_001) },
      ],
    };
    const shortSale = {
      ...fill,
      cashPostings: [{ ...fill.cashPostings[0], amountMinor: BigInt(5_000) }],
      positionPostings: [
        { instrumentId: "instrument-1", quantityShares: BigInt(-1) },
      ],
    };
    expect(() => replayPaperLedger([opening, overspend])).toThrow(
      "paper_ledger_negative_cash",
    );
    expect(() => replayPaperLedger([opening, shortSale])).toThrow(
      "paper_ledger_short_position",
    );
  });

  it("posts a versioned fee once and rolls back an overspend", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);
      const opening = fixture.database.orm.select().from(ledgerEvents).get()!;
      const effectiveAtMs = opening.effectiveAtMs + BigInt(1);
      appendPaperLedgerEvent(fixture.database, {
        eventType: "FEE",
        idempotencyKey: "fee:commission:1",
        effectiveAtMs,
        ruleVersion: "paper-fee-v1",
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-500),
        },
      });
      expect(() =>
        appendPaperLedgerEvent(fixture.database, {
          eventType: "FEE",
          idempotencyKey: "fee:commission:1",
          effectiveAtMs,
          ruleVersion: "paper-fee-v1",
          cashPosting: {
            bucket: "SETTLED",
            currencyCode: "JPY",
            currencyScale: 0,
            amountMinor: BigInt(-50),
          },
        }),
      ).toThrow("paper_ledger_idempotency_key_conflict");
      expect(() =>
        appendPaperLedgerEvent(fixture.database, {
          eventType: "FEE",
          idempotencyKey: "fee:overspend",
          effectiveAtMs,
          ruleVersion: "paper-fee-v1",
          cashPosting: {
            bucket: "SETTLED",
            currencyCode: "JPY",
            currencyScale: 0,
            amountMinor: BigInt(-1_000_001),
          },
        }),
      ).toThrow("paper_ledger_negative_cash");

      const ledger = readPaperLedger(fixture.database);
      expect(ledger?.events).toHaveLength(2);
      expect(ledger?.projection.cashBalances.get("JPY")?.settled).toBe(
        BigInt(999_500),
      );
      expect(ledger?.projection.feesByCurrency.get("JPY")).toBe(BigInt(500));
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects Fixture evidence as the basis for an instrument or fill", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);
      const sourceRecordId = fixtureQuote(fixture.database);
      expect(() =>
        registerPaperInstrument(fixture.database, {
          marketCode: "JP",
          assetClass: "COMMON_STOCK",
          tradingUnit: BigInt(100),
          classificationSourceRecordId: sourceRecordId,
        }),
      ).toThrow("paper_ledger_source_unverified");
      expect(() =>
        appendPaperLedgerEvent(fixture.database, {
          eventType: "FILL",
          idempotencyKey: "fixture-fill",
          effectiveAtMs: BigInt(Date.now() - 1_000),
          ruleVersion: "paper-fill-v1",
          sourceRecordId,
          cashPosting: {
            bucket: "SETTLED",
            currencyCode: "JPY",
            currencyScale: 0,
            amountMinor: BigInt(-100),
          },
          positionPosting: {
            instrumentId: "unknown-instrument",
            quantityShares: BigInt(1),
          },
        }),
      ).toThrow("paper_ledger_source_unverified");
      expect(
        fixture.database.orm.select().from(ledgerEvents).all(),
      ).toHaveLength(1);
      expect(fixture.database.orm.select().from(instruments).all()).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("stores an idempotent verified cash valuation with immutable evidence", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);
      const asOfMs = BigInt(Date.now());
      const first = createPaperEquitySnapshot(fixture.database, asOfMs);
      const duplicate = createPaperEquitySnapshot(fixture.database, asOfMs);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      const laterAsOfMs = BigInt(Date.now());
      const later = createPaperEquitySnapshot(fixture.database, laterAsOfMs);

      expect(first).toMatchObject({
        status: "VERIFIED",
        equityMinor: BigInt(1_000_000),
        currencyCode: "JPY",
        currencyScale: 0,
        unresolvedReason: null,
      });
      expect(duplicate.id).toBe(first.id);
      expect(later.id).not.toBe(first.id);
      expect(later.asOfMs).toBe(laterAsOfMs);
      expect(
        fixture.database.orm.select().from(equityValuations).all(),
      ).toHaveLength(2);
      expect(
        fixture.database.orm.select().from(equityValuationEvidence).all(),
      ).toHaveLength(2);
      expect(() =>
        fixture.database.orm
          .update(equityValuations)
          .set({ equityMinor: BigInt(2) })
          .where(eq(equityValuations.id, first.id))
          .run(),
      ).toThrow("equity_valuations are append-only");
      expect(() =>
        fixture.database.orm
          .delete(equityValuationEvidence)
          .where(eq(equityValuationEvidence.valuationId, first.id))
          .run(),
      ).toThrow("equity_valuation_evidence are append-only");
    } finally {
      await fixture.cleanup();
    }
  });

  it("values verified holdings from the matching licensed quote", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);
      const marketAtMs = Date.now() - 1_000;
      const classificationContent = JSON.stringify({ schemaVersion: 1 });
      const classificationSourceRecordId = trustedMarketRecord(
        fixture.database,
        "DISCLOSURE",
        classificationContent,
        marketAtMs,
      );
      const instrument = registerPaperInstrument(fixture.database, {
        marketCode: "JP",
        assetClass: "COMMON_STOCK",
        tradingUnit: BigInt(100),
        classificationSourceRecordId,
      });
      const quoteContent = JSON.stringify({
        schemaVersion: 1,
        instrumentId: instrument.id,
        currencyCode: "JPY",
        price: "1000",
        marketAtMs,
        validFromMs: marketAtMs - 60_000,
        validUntilMs: marketAtMs + 60_000,
      });
      const quoteSourceRecordId = trustedMarketRecord(
        fixture.database,
        "MARKET_QUOTE",
        quoteContent,
        marketAtMs,
      );
      appendPaperLedgerEvent(fixture.database, {
        eventType: "FILL",
        idempotencyKey: "equity-mark-fill",
        effectiveAtMs: BigInt(Date.now()),
        ruleVersion: "paper-fill-v1",
        sourceRecordId: quoteSourceRecordId,
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-100_000),
        },
        positionPosting: {
          instrumentId: instrument.id,
          quantityShares: BigInt(100),
        },
      });

      const valuation = createPaperEquitySnapshot(
        fixture.database,
        BigInt(Date.now()),
        [
          {
            role: "POSITION_QUOTE",
            instrumentId: instrument.id,
            sourceRecordId: quoteSourceRecordId,
            content: quoteContent,
          },
        ],
      );

      expect(valuation).toMatchObject({
        status: "VERIFIED",
        equityMinor: BigInt(1_000_000),
        unresolvedReason: null,
      });
      const evidence = fixture.database.orm
        .select()
        .from(equityValuationMarketEvidence)
        .all();
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({
        valuationId: valuation.id,
        role: "POSITION_QUOTE",
        instrumentId: instrument.id,
        sourceRecordId: quoteSourceRecordId,
        contentHashSha256: createHash("sha256")
          .update(quoteContent)
          .digest("hex"),
        content: quoteContent,
      });
      expect(() =>
        fixture.database.orm
          .update(equityValuationMarketEvidence)
          .set({ content: "{}" })
          .where(eq(equityValuationMarketEvidence.id, evidence[0].id))
          .run(),
      ).toThrow("equity_valuation_market_evidence are append-only");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps an unpriced Fixture position unresolved without an equity amount", async () => {
    const fixture = await createTestDatabase();
    try {
      const account = initializeDefaultPaperAccount(fixture.database);
      const sourceRecordId = fixtureQuote(fixture.database);
      const opening = fixture.database.orm
        .select()
        .from(ledgerEvents)
        .where(eq(ledgerEvents.accountId, account.id))
        .get()!;
      const instrumentId = randomUUID();
      fixture.database.orm
        .insert(instruments)
        .values({
          id: instrumentId,
          marketCode: "JP",
          assetClass: "UNKNOWN",
          quoteCurrencyCode: "JPY",
          tradingUnit: BigInt(100),
          exchangeTimeZone: "Asia/Tokyo",
          classificationStatus: "NOT_VERIFIED",
          classificationSourceRecordId: null,
          createdAtMs: BigInt(100),
        })
        .run();
      const fillId = randomUUID();
      const effectiveAtMs = opening.effectiveAtMs + BigInt(1);
      fixture.database.orm
        .insert(ledgerEvents)
        .values({
          id: fillId,
          accountId: account.id,
          sequenceNo: BigInt(2),
          eventType: "FILL",
          idempotencyKey: "fixture-position",
          effectiveAtMs,
          recordedAtMs: BigInt(Date.now()),
          ruleVersion: "paper-fill-v1",
          sourceRecordId,
        })
        .run();
      fixture.database.orm
        .insert(cashLedgerEntries)
        .values({
          id: randomUUID(),
          ledgerEventId: fillId,
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-100),
        })
        .run();
      fixture.database.orm
        .insert(positionLedgerEntries)
        .values({
          id: randomUUID(),
          ledgerEventId: fillId,
          instrumentId,
          quantityShares: BigInt(1),
        })
        .run();

      const valuation = createPaperEquitySnapshot(
        fixture.database,
        BigInt(Date.now()),
      );
      expect(valuation).toMatchObject({
        status: "UNRESOLVED",
        equityMinor: null,
        unresolvedReason: "position_market_value_unavailable",
        ledgerSequenceNo: BigInt(2),
      });
      expect(
        fixture.database.orm
          .select()
          .from(equityValuationEvidence)
          .where(eq(equityValuationEvidence.ledgerEventId, opening.id))
          .all(),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });
});
