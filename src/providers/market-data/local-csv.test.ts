import { describe, expect, it } from "vitest";

import { parseLocalOhlcvCsv } from "./local-csv";

describe("local daily OHLCV CSV", () => {
  it("normalizes quoted grouped values, BOM, CRLF, and unsorted dates", () => {
    const csv = [
      "\uFEFFDate,Open,High,Low,Close/Last,Volume",
      '2024-02-01,"1,234.5","1,240.00","1,230.0","1,235.00","1,000"',
      "2024-01-31,10,12,9,11,500",
    ].join("\r\n");

    expect(parseLocalOhlcvCsv(new TextEncoder().encode(csv))).toEqual([
      {
        tradingDate: "2024-01-31",
        csvSymbol: null,
        openMantissa: BigInt(10),
        highMantissa: BigInt(12),
        lowMantissa: BigInt(9),
        closeMantissa: BigInt(11),
        priceScale: 0,
        volumeShares: BigInt(500),
      },
      {
        tradingDate: "2024-02-01",
        csvSymbol: null,
        openMantissa: BigInt(123450),
        highMantissa: BigInt(124000),
        lowMantissa: BigInt(123000),
        closeMantissa: BigInt(123500),
        priceScale: 2,
        volumeShares: BigInt(1000),
      },
    ]);
  });

  it("rejects duplicate dates and invalid OHLC ranges", () => {
    const duplicateDate = [
      "Date,Open,High,Low,Close,Volume",
      "2024-01-01,10,12,9,11,100",
      "2024-01-01,10,12,9,11,100",
    ].join("\n");
    const invalidRange = [
      "Date,Open,High,Low,Close,Volume",
      "2024-01-01,10,9,8,11,100",
    ].join("\n");

    expect(() =>
      parseLocalOhlcvCsv(new TextEncoder().encode(duplicateDate)),
    ).toThrow("DUPLICATE_DATE");
    expect(() =>
      parseLocalOhlcvCsv(new TextEncoder().encode(invalidRange)),
    ).toThrow("INVALID_DATA_ROW");
  });

  it("rejects invalid calendar dates and missing required columns", () => {
    const invalidDate = [
      "Date,Open,High,Low,Close,Volume",
      "2024-02-30,10,12,9,11,100",
    ].join("\n");
    const missingVolume = [
      "Date,Open,High,Low,Close",
      "2024-01-01,10,12,9,11",
    ].join("\n");

    expect(() =>
      parseLocalOhlcvCsv(new TextEncoder().encode(invalidDate)),
    ).toThrow("INVALID_DATA_ROW");
    expect(() =>
      parseLocalOhlcvCsv(new TextEncoder().encode(missingVolume)),
    ).toThrow("INVALID_HEADERS");
  });

  it("preserves an optional ticker column for an explicit import match", () => {
    const csv = [
      "Date,Ticker,Open,High,Low,Close,Volume",
      "2024-01-01,AAPL,10,12,9,11,100",
    ].join("\n");

    expect(parseLocalOhlcvCsv(new TextEncoder().encode(csv))[0].csvSymbol).toBe(
      "AAPL",
    );
  });
});
