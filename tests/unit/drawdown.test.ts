import { describe, expect, it } from "vitest";

import {
  calculatePaperEquity,
  isDrawdownLimitReached,
} from "@/features/risk/drawdown";

const asOfMs = BigInt(1_000);
const jpInstrumentId = "00000000-0000-4000-8000-000000000001";
const usInstrumentId = "00000000-0000-4000-8000-000000000002";

const validFxEvidence = {
  role: "FX_RATE",
  sourceRecordId: "fx-record",
  contentHashSha256: "a".repeat(64),
  payload: {
    schemaVersion: 1,
    baseCurrency: "USD",
    quoteCurrency: "JPY",
    rate: "150",
    marketAtMs: 950,
    validFromMs: 900,
    validUntilMs: 1_100,
  },
} as const;

describe("paper equity and drawdown", () => {
  it("values JPY and USD cash and holdings in JPY with conservative rounding", () => {
    const result = calculatePaperEquity({
      asOfMs,
      cashBalances: [
        {
          currencyCode: "JPY",
          settled: BigInt(700_000),
          receivable: BigInt(0),
          payable: BigInt(0),
        },
        {
          currencyCode: "USD",
          settled: BigInt(10_050),
          receivable: BigInt(0),
          payable: BigInt(0),
        },
      ],
      positions: [
        {
          instrumentId: jpInstrumentId,
          quantityShares: BigInt(5),
          quoteCurrencyCode: "JPY",
          classificationStatus: "VERIFIED",
        },
        {
          instrumentId: usInstrumentId,
          quantityShares: BigInt(3),
          quoteCurrencyCode: "USD",
          classificationStatus: "VERIFIED",
        },
      ],
      marketEvidence: [
        {
          role: "POSITION_QUOTE",
          instrumentId: jpInstrumentId,
          sourceRecordId: "jp-quote-record",
          contentHashSha256: "b".repeat(64),
          payload: {
            schemaVersion: 1,
            instrumentId: jpInstrumentId,
            currencyCode: "JPY",
            price: "100.1",
            marketAtMs: 950,
            validFromMs: 900,
            validUntilMs: 1_100,
          },
        },
        {
          role: "POSITION_QUOTE",
          instrumentId: usInstrumentId,
          sourceRecordId: "us-quote-record",
          contentHashSha256: "c".repeat(64),
          payload: {
            schemaVersion: 1,
            instrumentId: usInstrumentId,
            currencyCode: "USD",
            price: "10.10",
            marketAtMs: 950,
            validFromMs: 900,
            validUntilMs: 1_100,
          },
        },
        validFxEvidence,
      ],
    });

    expect(result).toMatchObject({
      status: "VERIFIED",
      equityMinor: BigInt(720_120),
      unresolvedReason: null,
    });
  });

  it("keeps equity unresolved when a required FX observation is expired", () => {
    const result = calculatePaperEquity({
      asOfMs,
      cashBalances: [
        {
          currencyCode: "USD",
          settled: BigInt(10_000),
          receivable: BigInt(0),
          payable: BigInt(0),
        },
      ],
      positions: [],
      marketEvidence: [
        {
          ...validFxEvidence,
          payload: { ...validFxEvidence.payload, validUntilMs: 999 },
        },
      ],
    });

    expect(result).toMatchObject({
      status: "UNRESOLVED",
      equityMinor: null,
      unresolvedReason: "fx_rate_unavailable",
    });
  });

  it("keeps equity unresolved when any held position lacks a valid mark", () => {
    const result = calculatePaperEquity({
      asOfMs,
      cashBalances: [],
      positions: [
        {
          instrumentId: jpInstrumentId,
          quantityShares: BigInt(1),
          quoteCurrencyCode: "JPY",
          classificationStatus: "VERIFIED",
        },
      ],
      marketEvidence: [],
    });

    expect(result).toMatchObject({
      status: "UNRESOLVED",
      equityMinor: null,
      unresolvedReason: "position_market_value_unavailable",
    });
  });

  it("blocks an exact 20% drawdown without floating-point arithmetic", () => {
    expect(isDrawdownLimitReached(BigInt(800_000), BigInt(1_000_000))).toBe(
      true,
    );
    expect(isDrawdownLimitReached(BigInt(800_001), BigInt(1_000_000))).toBe(
      false,
    );
  });

  it("keeps the 20% boundary exact across equity scales", () => {
    for (const peak of [
      BigInt(5),
      BigInt(100),
      BigInt(10_000),
      BigInt(1_000_000),
    ]) {
      const boundary = (peak * BigInt(4)) / BigInt(5);

      expect(isDrawdownLimitReached(boundary, peak)).toBe(true);
      expect(isDrawdownLimitReached(boundary + BigInt(1), peak)).toBe(false);
      expect(isDrawdownLimitReached(boundary - BigInt(1), peak)).toBe(true);
    }
  });
});
