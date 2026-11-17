import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import { initializeDefaultPaperAccount } from "@/db/paper-account-repository";
import { appendPaperLedgerEvent } from "@/features/paper/ledger";
import {
  appendSourceRecord,
  registerSource,
} from "@/features/evidence/repository";
import {
  instruments,
  paperPlanVersions,
  planApprovals,
  planInputEvidence,
  riskDecisions,
} from "@/db/schema";
import {
  approvePaperPlan,
  createPaperPlan,
  createPaperPlanVersion,
} from "./checker";

type RecordOptions = {
  content: string;
  recordType: "MARKET_QUOTE" | "DISCLOSURE" | "OTHER";
  occurredAtMs: number;
  authorityRole?: "EXCHANGE_PRIMARY" | "FIXTURE";
  dataClass?: "REAL" | "FIXTURE";
};

async function createPlanFixture(
  options: {
    quantity?: string;
    stop?: string;
    price?: string;
    quoteExpiresAtMs?: number;
    fixedQuoteTime?: number;
    classFixture?: boolean;
  } = {},
) {
  const fixture = await createTestDatabase();
  initializeDefaultPaperAccount(fixture.database);
  const now = Date.now();
  const instrumentId = randomUUID();

  function addRecord({
    content,
    recordType,
    occurredAtMs,
    authorityRole = "EXCHANGE_PRIMARY",
    dataClass = "REAL",
  }: RecordOptions) {
    const source = registerSource(fixture.database, {
      sourceKey: `test-${randomUUID()}`,
      publisher: "Test exchange",
      sourceType: "EXCHANGE",
      authorityRole,
      referenceUrl: "https://example.com/source",
      licenseUrl: "https://example.com/license",
      licenseStatus: "VERIFIED",
      credentialRequirement: "NOT_REQUIRED",
    });
    return appendSourceRecord(fixture.database, {
      sourceId: source.id,
      recordKey: `test-${randomUUID()}`,
      recordType,
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: null,
      occurredAtMs,
      availableAtMs: null,
      rawTimeText: null,
      sourceTimeZone: "Asia/Tokyo",
      canonicalUrl: null,
      dataClass,
      content,
    });
  }

  const classificationContent = JSON.stringify({
    schemaVersion: 1,
    instrumentId,
    marketCode: "JP",
    assetClass: "COMMON_STOCK",
    quoteCurrencyCode: "JPY",
    tradingUnit: "100",
    validFromMs: now - 60_000,
    validUntilMs: now + 60_000,
  });
  const classificationRecord = addRecord({
    content: classificationContent,
    recordType: "DISCLOSURE",
    occurredAtMs: now - 1_000,
    authorityRole: options.classFixture ? "FIXTURE" : "EXCHANGE_PRIMARY",
    dataClass: options.classFixture ? "FIXTURE" : "REAL",
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
      createdAtMs: BigInt(now),
    })
    .run();

  const quoteTime = options.fixedQuoteTime ?? now;
  const quoteContent = JSON.stringify({
    schemaVersion: 1,
    instrumentId,
    currencyCode: "JPY",
    price: options.price ?? "1000",
    marketAtMs: quoteTime,
    validFromMs: now - 60_000,
    validUntilMs: options.quoteExpiresAtMs ?? now + 60_000,
  });
  const quoteRecord = addRecord({
    content: quoteContent,
    recordType: "MARKET_QUOTE",
    occurredAtMs: quoteTime,
  });
  const modelContent = JSON.stringify({
    schemaVersion: 1,
    version: "jp-test-cost-v1",
    marketCode: "JP",
    currencyCode: "JPY",
    validFromMs: now - 60_000,
    validUntilMs: now + 60_000,
    tickSize: "1",
    entrySlippageBps: 0,
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
    occurredAtMs: now - 1_000,
  });

  return {
    ...fixture,
    instrumentId,
    input: {
      candidate: {
        candidateId: randomUUID(),
        summary: "Test strategy candidate",
        evidenceRecordIds: [classificationRecord.id],
      },
      instrumentId,
      requestedQuantityShares: options.quantity ?? "100",
      stopReferencePrice: options.stop ?? "805",
      classificationEvidence: {
        sourceRecordId: classificationRecord.id,
        content: classificationContent,
      },
      quoteEvidence: {
        sourceRecordId: quoteRecord.id,
        content: quoteContent,
      },
      riskModelEvidence: {
        sourceRecordId: modelRecord.id,
        content: modelContent,
      },
      fxEvidence: null,
    },
  };
}

describe("deterministic paper risk checker", () => {
  it("allows an exact 2% risk plan and approves only a freshly rechecked version", async () => {
    const fixture = await createPlanFixture();
    try {
      const plan = createPaperPlan(fixture.database, fixture.input);

      expect(plan.decision).toMatchObject({
        status: "PASS",
        reasonCodes: [],
        requestedQuantityShares: BigInt(100),
        maxAllowedQuantityShares: BigInt(100),
        equityMinor: BigInt(1_000_000),
        riskBudgetMinor: BigInt(20_000),
        plannedLossJpyMinor: BigInt(20_000),
      });
      expect(
        fixture.database.orm.select().from(planInputEvidence).all(),
      ).toHaveLength(4);

      const approved = approvePaperPlan(
        fixture.database,
        plan.version.id,
        plan.version.planHashSha256,
      );

      expect(approved.decision.status).toBe("PASS");
      expect(approved.approval?.riskDecisionId).toBe(approved.decision.id);
      expect(
        fixture.database.orm.select().from(planApprovals).all(),
      ).toHaveLength(1);
      expect(
        fixture.database.orm.select().from(riskDecisions).all(),
      ).toHaveLength(2);

      const nextVersion = createPaperPlanVersion(
        fixture.database,
        plan.plan.id,
        { ...fixture.input, stopReferencePrice: "900" },
      );
      expect(nextVersion.version.planHashSha256).not.toBe(
        plan.version.planHashSha256,
      );
      expect(
        fixture.database.orm
          .select()
          .from(planApprovals)
          .where(eq(planApprovals.planVersionId, nextVersion.version.id))
          .all(),
      ).toHaveLength(0);
      expect(() =>
        fixture.database.orm
          .update(paperPlanVersions)
          .set({ requestedQuantityShares: BigInt(200) })
          .where(eq(paperPlanVersions.id, plan.version.id))
          .run(),
      ).toThrow("paper_plan_versions are immutable");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects risk over 2% and the database will not accept an AI-style approval override", async () => {
    const fixture = await createPlanFixture({ quantity: "200" });
    try {
      const plan = createPaperPlan(fixture.database, fixture.input);
      expect(plan.decision.status).toBe("REJECT");
      expect(plan.decision.reasonCodes).toEqual(["RISK_BUDGET_EXCEEDED"]);
      expect(plan.decision.maxAllowedQuantityShares).toBe(BigInt(100));

      const approvalAttempt = approvePaperPlan(
        fixture.database,
        plan.version.id,
        plan.version.planHashSha256,
      );
      expect(approvalAttempt.decision.status).toBe("REJECT");
      expect(approvalAttempt.approval).toBeNull();
      expect(() =>
        fixture.database.orm
          .insert(planApprovals)
          .values({
            id: randomUUID(),
            planVersionId: plan.version.id,
            planHashSha256: plan.version.planHashSha256,
            riskDecisionId: plan.decision.id,
            approvedAtMs: BigInt(Date.now()),
          })
          .run(),
      ).toThrow("plan_approval_requires_matching_pass");
      expect(
        fixture.database.orm.select().from(planApprovals).all(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }

    const stalePass = await createPlanFixture();
    try {
      const plan = createPaperPlan(stalePass.database, stalePass.input);
      expect(plan.decision.status).toBe("PASS");

      appendPaperLedgerEvent(stalePass.database, {
        eventType: "FEE",
        idempotencyKey: "stale-risk-approval-fee",
        effectiveAtMs: BigInt(Date.now()),
        ruleVersion: "paper-fee-v1",
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-200_000),
        },
      });
      const currentDecision = approvePaperPlan(
        stalePass.database,
        plan.version.id,
        plan.version.planHashSha256,
      );
      expect(currentDecision.decision.status).toBe("REJECT");

      expect(() =>
        stalePass.database.orm
          .insert(planApprovals)
          .values({
            id: randomUUID(),
            planVersionId: plan.version.id,
            planHashSha256: plan.version.planHashSha256,
            riskDecisionId: plan.decision.id,
            approvedAtMs: BigInt(Date.now()),
          })
          .run(),
      ).toThrow("plan_approval_requires_matching_pass");
    } finally {
      await stalePass.cleanup();
    }
  });

  it("keeps expired and fixture source data unresolved", async () => {
    const expired = await createPlanFixture({
      quoteExpiresAtMs: Date.now() - 1,
      fixedQuoteTime: Date.now() - 2_000,
    });
    try {
      const plan = createPaperPlan(expired.database, expired.input);
      expect(plan.decision.status).toBe("UNRESOLVED");
      expect(plan.decision.reasonCodes).toEqual(["QUOTE_UNAVAILABLE"]);
      expect(
        approvePaperPlan(
          expired.database,
          plan.version.id,
          plan.version.planHashSha256,
        ).approval,
      ).toBeNull();
    } finally {
      await expired.cleanup();
    }

    const fixture = await createPlanFixture({ classFixture: true });
    try {
      const plan = createPaperPlan(fixture.database, fixture.input);
      expect(plan.decision.status).toBe("UNRESOLVED");
      expect(plan.decision.reasonCodes).toEqual(["FIXTURE_EVIDENCE"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects an invalid lot, insufficient settled cash, and the exact 20% drawdown boundary", async () => {
    const invalidLot = await createPlanFixture({ quantity: "50" });
    try {
      const plan = createPaperPlan(invalidLot.database, invalidLot.input);
      expect(plan.decision.status).toBe("REJECT");
      expect(plan.decision.reasonCodes).toEqual(["INVALID_QUANTITY_UNIT"]);
    } finally {
      await invalidLot.cleanup();
    }

    const insufficientCash = await createPlanFixture({
      price: "12000",
      stop: "11900",
    });
    try {
      const plan = createPaperPlan(
        insufficientCash.database,
        insufficientCash.input,
      );
      expect(plan.decision.status).toBe("REJECT");
      expect(plan.decision.reasonCodes).toEqual(["INSUFFICIENT_SETTLED_CASH"]);
      expect(plan.decision.maxAllowedQuantityShares).toBe(BigInt(0));

      appendPaperLedgerEvent(insufficientCash.database, {
        eventType: "FEE",
        idempotencyKey: "drawdown-test-fee",
        effectiveAtMs: BigInt(Date.now()),
        ruleVersion: "paper-fee-v1",
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-200_000),
        },
      });
      const drawdownPlan = createPaperPlan(
        insufficientCash.database,
        insufficientCash.input,
      );
      expect(drawdownPlan.decision.status).toBe("REJECT");
      expect(drawdownPlan.decision.reasonCodes).toEqual([
        "DRAWDOWN_LIMIT_REACHED",
      ]);
    } finally {
      await insufficientCash.cleanup();
    }
  });
});
