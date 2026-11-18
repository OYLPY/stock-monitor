import { describe, expect, it, vi } from "vitest";

import { initializeDefaultPaperAccount } from "@/db/paper-account-repository";
import { createTestDatabase } from "@/db/test-database";
import { createPaperEquitySnapshot } from "@/features/risk/drawdown";
import { appendPaperLedgerEvent } from "./ledger";
import { auditPaperLedger } from "./audit";

describe("paper ledger audit", () => {
  it("does not report a curve or drawdown before verified valuations exist", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);

      const audit = auditPaperLedger(fixture.database);

      expect(audit?.ledger).toEqual({ status: "VERIFIED", issueCodes: [] });
      expect(audit?.trades).toEqual([]);
      expect(audit?.equity).toMatchObject({
        status: "NOT_VERIFIED",
        maximumDrawdown: null,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("replays verified equity snapshots and detects persisted-value tampering", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fixture = await createTestDatabase();
    const openedAt = BigInt(1_800_000_000_000);
    try {
      vi.setSystemTime(Number(openedAt));
      initializeDefaultPaperAccount(fixture.database);

      vi.setSystemTime(Number(openedAt + BigInt(2_000)));
      appendPaperLedgerEvent(fixture.database, {
        eventType: "FEE",
        idempotencyKey: "audit-test-fee-1",
        effectiveAtMs: openedAt + BigInt(1_000),
        ruleVersion: "paper-fee-v1",
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-100_000),
        },
      });
      createPaperEquitySnapshot(fixture.database, openedAt + BigInt(1_500));

      vi.setSystemTime(Number(openedAt + BigInt(4_000)));
      appendPaperLedgerEvent(fixture.database, {
        eventType: "FEE",
        idempotencyKey: "audit-test-fee-2",
        effectiveAtMs: openedAt + BigInt(2_500),
        ruleVersion: "paper-fee-v1",
        cashPosting: {
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: BigInt(-100_000),
        },
      });
      createPaperEquitySnapshot(fixture.database, openedAt + BigInt(3_000));

      const audit = auditPaperLedger(fixture.database);

      expect(audit?.equity.status).toBe("VERIFIED");
      expect(audit?.equity.curve.map(({ equityMinor }) => equityMinor)).toEqual(
        ["1000000", "900000", "800000"],
      );
      expect(audit?.equity.maximumDrawdown).toMatchObject({
        basisPoints: "2000",
        peakMinor: "1000000",
        troughMinor: "800000",
      });

      fixture.database.client.exec("DROP TRIGGER equity_valuations_no_update");
      fixture.database.client
        .prepare(
          "UPDATE equity_valuations SET equity_minor = 1 WHERE as_of_ms = ?",
        )
        .run(openedAt + BigInt(3_000));
      const tampered = auditPaperLedger(fixture.database);
      expect(tampered?.equity).toMatchObject({
        status: "NOT_VERIFIED",
        issueCodes: ["EQUITY_VALUATION_INVALID"],
        curve: [],
        maximumDrawdown: null,
      });
    } finally {
      vi.useRealTimers();
      await fixture.cleanup();
    }
  });
});
