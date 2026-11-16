import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";
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
});
