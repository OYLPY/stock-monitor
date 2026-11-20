import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { marketDateAt } from "@/domain/primitives";
import {
  auditEvents,
  marketPriceBars,
  sourceRecords,
  sources,
} from "@/db/schema";
import { createTestDatabase } from "@/db/test-database";
import { getEodhdDailyUsage, syncUsMarketHistory } from "./us-provider";

afterEach(() => vi.unstubAllGlobals());

function csv() {
  // Synthetic parser fixture only; it is never presented as market data.
  return `Date,Open,High,Low,Close,Volume\n${marketDateAt(Date.now(), "US")},10,12,9,11,1000`;
}

describe("US historical market data persistence", () => {
  it("stores source provenance and reuses the 24-hour local cache", async () => {
    const fixture = await createTestDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(csv(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = await syncUsMarketHistory(fixture.database, {
        symbol: "aapl",
        token: "private-test-token",
      });
      const replay = await syncUsMarketHistory(fixture.database, {
        symbol: "AAPL",
        token: undefined,
      });
      const bars = fixture.database.orm.select().from(marketPriceBars).all();
      const record = fixture.database.orm.select().from(sourceRecords).get();
      const source = fixture.database.orm.select().from(sources).get();

      expect(first).toMatchObject({
        symbol: "AAPL",
        dataClass: "HISTORICAL",
        cacheHit: false,
        rowsAdded: 1,
        rowsReceived: 1,
        used: 1,
        limit: 20,
      });
      expect(replay).toMatchObject({ cacheHit: true, rowsAdded: 0, used: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bars).toHaveLength(1);
      expect(record?.dataClass).toBe("HISTORICAL");
      expect(source).toMatchObject({
        sourceKey: "eodhd-us-eod",
        licenseStatus: "VERIFIED",
        credentialRequirement: "REQUIRED",
      });
      expect(getEodhdDailyUsage(fixture.database).used).toBe(1);
      expect(
        fixture.database.orm
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityType, "EODHD_REQUEST"))
          .all(),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not call the provider when the persistent free daily allowance is exhausted", async () => {
    const fixture = await createTestDatabase();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(csv(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      for (let index = 0; index < 20; index += 1) {
        await syncUsMarketHistory(fixture.database, {
          symbol: `A${index}`,
          token: "private-test-token",
        });
      }

      await expect(
        syncUsMarketHistory(fixture.database, {
          symbol: "A20",
          token: "private-test-token",
        }),
      ).rejects.toMatchObject({ code: "DAILY_LIMIT_REACHED" });
      expect(fetchMock).toHaveBeenCalledTimes(20);
      expect(getEodhdDailyUsage(fixture.database).used).toBe(20);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not fetch without a configured key", async () => {
    const fixture = await createTestDatabase();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        syncUsMarketHistory(fixture.database, {
          symbol: "AAPL",
          token: "  ",
        }),
      ).rejects.toMatchObject({ code: "CREDENTIAL_MISSING" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getEodhdDailyUsage(fixture.database).used).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
