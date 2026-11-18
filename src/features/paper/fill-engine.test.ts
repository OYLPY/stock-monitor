import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import { initializeDefaultPaperAccount } from "@/db/paper-account-repository";
import {
  instruments,
  ledgerEvents,
  paperFills,
  paperOrderEvents,
  paperOrders,
} from "@/db/schema";
import {
  appendSourceRecord,
  registerSource,
} from "@/features/evidence/repository";
import { createPaperEquitySnapshot } from "@/features/risk/drawdown";
import { approvePaperPlan, createPaperPlan } from "@/features/risk/checker";
import {
  cancelPaperOrder,
  createPaperOrder,
  executePaperOrder,
} from "./fill-engine";

const openAt = Date.parse("2026-11-18T01:00:00.000Z");

async function createFixture() {
  const fixture = await createTestDatabase();
  const instrumentId = randomUUID();

  function addRecord(input: {
    content: string;
    recordType: "MARKET_QUOTE" | "DISCLOSURE" | "OTHER";
    occurredAtMs: number;
    dataClass?: "REAL" | "FIXTURE";
  }) {
    const isFixture = input.dataClass === "FIXTURE";
    const source = registerSource(fixture.database, {
      sourceKey: `test-${randomUUID()}`,
      publisher: "Test exchange",
      sourceType: "EXCHANGE",
      authorityRole: isFixture ? "FIXTURE" : "EXCHANGE_PRIMARY",
      referenceUrl: "https://example.com/source",
      licenseUrl: "https://example.com/license",
      licenseStatus: isFixture ? "NOT_VERIFIED" : "VERIFIED",
      credentialRequirement: "NOT_REQUIRED",
    });
    return appendSourceRecord(fixture.database, {
      sourceId: source.id,
      recordKey: `test-${randomUUID()}`,
      recordType: input.recordType,
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: null,
      occurredAtMs: input.occurredAtMs,
      availableAtMs: null,
      rawTimeText: null,
      sourceTimeZone: "Asia/Tokyo",
      canonicalUrl: null,
      dataClass: input.dataClass ?? "REAL",
      content: input.content,
    });
  }

  vi.setSystemTime(openAt);
  initializeDefaultPaperAccount(fixture.database);
  const classificationContent = JSON.stringify({
    schemaVersion: 1,
    instrumentId,
    marketCode: "JP",
    assetClass: "COMMON_STOCK",
    quoteCurrencyCode: "JPY",
    tradingUnit: "100",
    validFromMs: openAt - 60_000,
    validUntilMs: openAt + 60_000,
  });
  const classificationRecord = addRecord({
    content: classificationContent,
    recordType: "DISCLOSURE",
    occurredAtMs: openAt - 1_000,
  });
  fixture.database.orm
    .insert(instruments)
    .values({
      id: instrumentId,
      marketCode: "JP",
      assetClass: "COMMON_STOCK",
      quoteCurrencyCode: "JPY",
      tradingUnit: BigInt(100),
      exchangeTimeZone: "Asia/Tokyo",
      classificationStatus: "VERIFIED",
      classificationSourceRecordId: classificationRecord.id,
      createdAtMs: BigInt(openAt),
    })
    .run();

  const quoteContent = JSON.stringify({
    schemaVersion: 1,
    instrumentId,
    currencyCode: "JPY",
    price: "100",
    marketAtMs: openAt,
    validFromMs: openAt - 60_000,
    validUntilMs: openAt + 60_000,
  });
  const quoteRecord = addRecord({
    content: quoteContent,
    recordType: "MARKET_QUOTE",
    occurredAtMs: openAt,
  });
  const modelContent = JSON.stringify({
    schemaVersion: 1,
    version: "jp-test-cost-v1",
    marketCode: "JP",
    currencyCode: "JPY",
    validFromMs: openAt - 60_000,
    validUntilMs: openAt + 86_400_000,
    tickSize: "1",
    entrySlippageBps: 100,
    maxParticipationBps: 5_000,
    stopSlippageBps: 0,
    gapReserveBps: 0,
    fxShockBps: 0,
    fxConversionFeeBps: 0,
    entryFee: { minimumMinor: "250", fixedMinor: "0", perShareMinor: "0" },
    exitFee: { minimumMinor: "250", fixedMinor: "0", perShareMinor: "0" },
  });
  const modelRecord = addRecord({
    content: modelContent,
    recordType: "OTHER",
    occurredAtMs: openAt - 1_000,
  });
  createPaperEquitySnapshot(fixture.database, BigInt(openAt));
  const input = {
    candidate: {
      candidateId: randomUUID(),
      summary: "Test candidate",
      evidenceRecordIds: [classificationRecord.id],
    },
    instrumentId,
    requestedQuantityShares: "300",
    stopReferencePrice: "90",
    classificationEvidence: {
      sourceRecordId: classificationRecord.id,
      content: classificationContent,
    },
    quoteEvidence: { sourceRecordId: quoteRecord.id, content: quoteContent },
    riskModelEvidence: {
      sourceRecordId: modelRecord.id,
      content: modelContent,
    },
    fxEvidence: null,
    equityEvidence: [],
  };
  const plan = createPaperPlan(fixture.database, input);
  expect(plan.decision.status).toBe("PASS");
  expect(
    approvePaperPlan(
      fixture.database,
      plan.version.id,
      plan.version.planHashSha256,
    ).approval,
  ).not.toBeNull();
  const order = createPaperOrder(fixture.database, {
    planVersionId: plan.version.id,
    expectedPlanHashSha256: plan.version.planHashSha256,
    idempotencyKey: "submit-test-order",
  });

  function addExecutionQuote(
    input: {
      price?: string;
      volumeShares?: string;
      marketAtMs?: number;
      dataClass?: "REAL" | "FIXTURE";
    } = {},
  ) {
    const marketAtMs = input.marketAtMs ?? Number(Date.now());
    const content = JSON.stringify({
      schemaVersion: 1,
      instrumentId,
      currencyCode: "JPY",
      price: input.price ?? "100",
      volumeShares: input.volumeShares ?? "1000",
      marketAtMs,
      validFromMs: openAt,
      validUntilMs: openAt + 86_400_000,
    });
    const record = addRecord({
      content,
      recordType: "MARKET_QUOTE",
      occurredAtMs: marketAtMs,
      dataClass: input.dataClass,
    });
    return { sourceRecordId: record.id, content };
  }

  return { ...fixture, addExecutionQuote, input, order };
}

describe("paper fill engine", () => {
  it("reserves approved plan cash, prevents double reservation, and is idempotent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = await createFixture();
    try {
      const replay = createPaperOrder(fixture.database, {
        planVersionId: fixture.order.planVersionId,
        expectedPlanHashSha256: fixture.order.planHashSha256,
        idempotencyKey: "submit-test-order",
      });
      expect(replay.id).toBe(fixture.order.id);
      expect(fixture.order.status).toBe("PENDING");
      expect(fixture.order.reservedAmountMinor).toBe(BigInt(30_550));
      expect(
        fixture.database.orm.select().from(paperOrders).all(),
      ).toHaveLength(1);
      expect(
        fixture.database.orm.select().from(paperOrderEvents).all(),
      ).toHaveLength(1);

      const cashLimitedPlan = createPaperPlan(fixture.database, {
        ...fixture.input,
        candidate: { ...fixture.input.candidate, candidateId: randomUUID() },
        requestedQuantityShares: "9600",
        stopReferencePrice: "99",
      });
      expect(cashLimitedPlan.decision.status).toBe("REJECT");
      expect(cashLimitedPlan.decision.reasonCodes).toContain(
        "INSUFFICIENT_SETTLED_CASH",
      );
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  });

  it("applies volume caps, adverse tick slippage, cumulative fees, and replay idempotency", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = await createFixture();
    try {
      const firstQuote = fixture.addExecutionQuote({ volumeShares: "200" });
      const first = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: firstQuote,
      });
      expect(first.status).toBe("PARTIALLY_FILLED");
      expect(first.fill?.quantityShares).toBe(BigInt(100));
      expect(first.fill?.priceMantissa).toBe(BigInt(10_100_000_000));
      expect(first.fill?.feeMinor).toBe(BigInt(250));
      expect(first.fill?.settlementDate).toBe("2026-11-20");

      const replay = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: firstQuote,
      });
      expect(replay.replayed).toBe(true);
      expect(fixture.database.orm.select().from(paperFills).all()).toHaveLength(
        1,
      );

      const second = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: fixture.addExecutionQuote({ volumeShares: "400" }),
      });
      expect(second.status).toBe("FILLED");
      expect(second.fill?.quantityShares).toBe(BigInt(200));
      expect(second.fill?.feeMinor).toBe(BigInt(0));
      expect(second.order.reservedAmountMinor).toBe(BigInt(0));
      expect(second.order.feesChargedMinor).toBe(BigInt(250));
      expect(fixture.database.orm.select().from(paperFills).all()).toHaveLength(
        2,
      );
      expect(
        fixture.database.orm.select().from(ledgerEvents).all(),
      ).toHaveLength(4);
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  });

  it("rejects fixture quotes without touching the ledger", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = await createFixture();
    try {
      const ledgerCount = fixture.database.orm
        .select()
        .from(ledgerEvents)
        .all().length;
      const result = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: fixture.addExecutionQuote({ dataClass: "FIXTURE" }),
      });
      expect(result.status).toBe("REJECTED");
      expect(result.resultClass).toBe("DEMO_ONLY");
      expect(result.reasonCode).toBe("FIXTURE_EVIDENCE");
      expect(result.order.status).toBe("PENDING");
      expect(fixture.database.orm.select().from(paperFills).all()).toHaveLength(
        0,
      );
      expect(
        fixture.database.orm.select().from(ledgerEvents).all(),
      ).toHaveLength(ledgerCount);
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  });

  it("rejects gaps that exceed the risk budget or cross the planned stop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = await createFixture();
    try {
      const result = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: fixture.addExecutionQuote({ price: "500" }),
      });
      expect(result.status).toBe("REJECTED");
      expect(result.reasonCode).toBe("GAP_EXCEEDS_RISK_BUDGET");
      expect(result.order.status).toBe("PENDING");
      expect(fixture.database.orm.select().from(paperFills).all()).toHaveLength(
        0,
      );

      const belowStop = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: fixture.addExecutionQuote({ price: "80" }),
      });
      expect(belowStop.status).toBe("REJECTED");
      expect(belowStop.reasonCode).toBe("ENTRY_PRICE_AT_OR_BELOW_STOP");
      expect(belowStop.order.status).toBe("PENDING");
      expect(fixture.database.orm.select().from(paperFills).all()).toHaveLength(
        0,
      );
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  });

  it("preserves partial fills when a closed quote is rejected and the remainder is canceled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = await createFixture();
    try {
      const partial = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: fixture.addExecutionQuote({ volumeShares: "200" }),
      });
      expect(partial.status).toBe("PARTIALLY_FILLED");
      expect(partial.fill?.quantityShares).toBe(BigInt(100));

      const lunchAt = openAt + 2 * 60 * 60 * 1000;
      vi.setSystemTime(lunchAt);
      const closedQuote = fixture.addExecutionQuote({ marketAtMs: lunchAt });
      const rejected = executePaperOrder(fixture.database, {
        orderId: fixture.order.id,
        quoteEvidence: closedQuote,
      });
      expect(rejected.reasonCode).toBe("MARKET_CLOSED");
      expect(rejected.order.reservedAmountMinor).toBe(BigInt(20_200));

      const canceled = cancelPaperOrder(fixture.database, {
        orderId: fixture.order.id,
        idempotencyKey: "cancel-test-order",
      });
      expect(canceled.status).toBe("CANCELED");
      expect(canceled.reservedAmountMinor).toBe(BigInt(0));
      expect(canceled.filledQuantityShares).toBe(BigInt(100));
      expect(
        cancelPaperOrder(fixture.database, {
          orderId: fixture.order.id,
          idempotencyKey: "cancel-test-order",
        }).status,
      ).toBe("CANCELED");
      expect(fixture.database.orm.select().from(paperFills).all()).toHaveLength(
        1,
      );
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  });
});
