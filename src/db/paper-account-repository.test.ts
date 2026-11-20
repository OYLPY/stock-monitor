import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";
import { cashLedgerEntries, ledgerEvents } from "./schema";
import {
  initializeDefaultPaperAccount,
  listPaperAccountLedger,
} from "./paper-account-repository";

describe("paper account ledger repository", () => {
  it("reports no account before explicit initialization", async () => {
    const fixture = await createTestDatabase();
    try {
      expect(listPaperAccountLedger(fixture.database)).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it("reads the opening event and exact cash posting without changing the ledger", async () => {
    const fixture = await createTestDatabase();
    try {
      initializeDefaultPaperAccount(fixture.database);

      const ledger = listPaperAccountLedger(fixture.database);

      expect(ledger?.account.baseCurrency).toBe("JPY");
      expect(ledger?.entries).toHaveLength(1);
      expect(ledger?.entries[0]).toMatchObject({
        sequenceNo: BigInt(1),
        eventType: "ACCOUNT_OPENED",
        currencyCode: "JPY",
        currencyScale: 0,
        amountMinor: BigInt(1_000_000),
      });
      expect(listPaperAccountLedger(fixture.database)?.entries).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("paginates ledger events without splitting their cash postings", async () => {
    const fixture = await createTestDatabase();
    try {
      const account = initializeDefaultPaperAccount(fixture.database);
      const events = Array.from({ length: 101 }, (_, index) => ({
        id: `event-${index + 2}`,
        accountId: account.id,
        sequenceNo: BigInt(index + 2),
        eventType: "RESERVATION",
        idempotencyKey: `pagination-${index + 2}`,
        effectiveAtMs: BigInt(index + 2),
        recordedAtMs: BigInt(index + 2),
        ruleVersion: "pagination-test-v1",
      }));
      fixture.database.orm.insert(ledgerEvents).values(events).run();
      fixture.database.orm
        .insert(cashLedgerEntries)
        .values(
          events.flatMap((event, index) => [
            {
              id: `cash-${index + 2}-1`,
              ledgerEventId: event.id,
              bucket: "SETTLED",
              currencyCode: "JPY",
              currencyScale: 0,
              amountMinor: BigInt(1),
            },
            ...(index === 0
              ? [
                  {
                    id: "cash-2-2",
                    ledgerEventId: event.id,
                    bucket: "SETTLED",
                    currencyCode: "USD",
                    currencyScale: 2,
                    amountMinor: BigInt(1),
                  },
                ]
              : []),
          ]),
        )
        .run();

      const firstPage = listPaperAccountLedger(fixture.database, 1);
      const lastPage = listPaperAccountLedger(fixture.database, 99);

      expect(firstPage).toMatchObject({
        page: 1,
        totalEventCount: 102,
        totalPages: 2,
        eventCount: 100,
        hasPrevious: false,
        hasNext: true,
      });
      expect(firstPage?.entries).toHaveLength(101);
      expect(
        new Set(firstPage?.entries.map((entry) => entry.eventId)).size,
      ).toBe(100);
      expect(lastPage).toMatchObject({
        page: 2,
        eventCount: 2,
        hasPrevious: true,
        hasNext: false,
      });
      expect(lastPage?.entries).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });
});
