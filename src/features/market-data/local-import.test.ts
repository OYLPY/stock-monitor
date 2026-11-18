import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { marketPriceBars, sourceRecords, sources } from "@/db/schema";
import { createTestDatabase } from "@/db/test-database";
import { importLocalMarketCsv, loadLocalMarketBars } from "./local-import";

const csv = new TextEncoder().encode(
  [
    "Date,Open,High,Low,Close,Volume",
    "2024-01-02,10.1,11,9.9,10.5,1000",
    "2024-01-03,10.5,11.2,10.2,11,1500",
  ].join("\n"),
);

describe("local market CSV import", () => {
  it("persists source-linked rows as NOT_VERIFIED and imports identical files once", async () => {
    const fixture = await createTestDatabase();
    try {
      const first = importLocalMarketCsv(fixture.database, {
        market: "US",
        symbol: "aapl",
        bytes: csv,
      });
      const repeated = importLocalMarketCsv(fixture.database, {
        market: "US",
        symbol: "AAPL",
        bytes: csv,
      });
      const bars = fixture.database.orm.select().from(marketPriceBars).all();
      const records = fixture.database.orm.select().from(sourceRecords).all();
      const source = fixture.database.orm.select().from(sources).get();

      expect(first).toMatchObject({
        market: "US",
        symbol: "AAPL",
        rowsInFile: 2,
        rowsAdded: 2,
        dateFrom: "2024-01-02",
        dateTo: "2024-01-03",
        dataClass: "NOT_VERIFIED",
      });
      expect(repeated.rowsAdded).toBe(0);
      expect(bars).toHaveLength(2);
      expect(records).toHaveLength(1);
      expect(records[0].dataClass).toBe("NOT_VERIFIED");
      expect(source?.licenseStatus).toBe("NOT_VERIFIED");

      fixture.database.client.close();
      const display = await loadLocalMarketBars(fixture.filePath);
      expect(display.US).toMatchObject([
        {
          symbol: "AAPL",
          tradingDate: "2024-01-03",
          close: "11.0",
          dataClass: "NOT_VERIFIED",
          licenseStatus: "NOT_VERIFIED",
        },
        {
          symbol: "AAPL",
          tradingDate: "2024-01-02",
          close: "10.5",
          dataClass: "NOT_VERIFIED",
        },
      ]);
      expect(display.JP).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not reuse an import record across symbols or markets", async () => {
    const fixture = await createTestDatabase();
    try {
      importLocalMarketCsv(fixture.database, {
        market: "US",
        symbol: "AAPL",
        bytes: csv,
      });
      importLocalMarketCsv(fixture.database, {
        market: "JP",
        symbol: "7203",
        bytes: csv,
      });

      const records = fixture.database.orm.select().from(sourceRecords).all();
      const japanBars = fixture.database.orm
        .select()
        .from(marketPriceBars)
        .where(eq(marketPriceBars.marketCode, "JP"))
        .all();

      expect(records).toHaveLength(2);
      expect(japanBars).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a CSV whose ticker column conflicts with the selected symbol", async () => {
    const fixture = await createTestDatabase();
    try {
      const mismatch = new TextEncoder().encode(
        [
          "Date,Ticker,Open,High,Low,Close,Volume",
          "2024-01-02,MSFT,10,11,9,10,1000",
        ].join("\n"),
      );

      expect(() =>
        importLocalMarketCsv(fixture.database, {
          market: "US",
          symbol: "AAPL",
          bytes: mismatch,
        }),
      ).toThrow("SYMBOL_MISMATCH");
      expect(fixture.database.orm.select().from(marketPriceBars).all()).toEqual(
        [],
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
