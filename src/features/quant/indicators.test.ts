import { describe, expect, it } from "vitest";

import { normalizeOhlcv } from "./indicators";
import type { OhlcvBarInput, OhlcvInput } from "./indicators";

function businessDates(count: number): string[] {
  const dates: string[] = [];
  for (let date = new Date("2026-01-05T00:00:00.000Z"); dates.length < count;) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      dates.push(date.toISOString().slice(0, 10));
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function bar(date: string, close = "100"): OhlcvBarInput {
  const closeValue = Number(close);
  return {
    date,
    open: close,
    high: String(closeValue + 1),
    low: String(closeValue - 1),
    close,
    volume: "100",
    sourceRecordId: `quote:${date}`,
  };
}

function input(overrides: Partial<OhlcvInput> = {}): OhlcvInput {
  const dates = businessDates(3);
  return {
    market: "JP",
    source: {
      sourceId: "fixture-prices",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
    },
    expectedSessions: {
      dates,
      sourceId: "fixture-calendar",
      verificationStatus: "NOT_VERIFIED",
    },
    adjustment: {
      basis: "RAW",
      coverage: "COMPLETE",
      sourceId: "fixture-actions",
      sourceRecordId: "fixture-action-coverage",
      actions: [],
    },
    bars: dates.map((date) => bar(date)),
    ...overrides,
  };
}

describe("normalizeOhlcv", () => {
  it("maps missing expected sessions as gaps and does not bridge returns across them", () => {
    const dates = businessDates(26);
    const bars = dates.flatMap((date, index) =>
      index === 15 ? [] : [bar(date, index < 15 ? "100" : "110")],
    );
    const result = normalizeOhlcv(
      input({
        expectedSessions: {
          dates,
          sourceId: "fixture-calendar",
          verificationStatus: "NOT_VERIFIED",
        },
        bars,
      }),
    );

    expect(result.sessions[15]).toMatchObject({
      sessionIndex: 15,
      status: "GAP",
      bar: null,
    });
    expect(result.sessions[16].indicators.dailyReturn).toEqual({
      value: null,
      status: "GAP",
    });
    expect(result.sessions.at(-1)?.indicators).toMatchObject({
      simpleMovingAverage20: { value: null, status: "INSUFFICIENT_HISTORY" },
      averageTrueRange14: { value: null, status: "INSUFFICIENT_HISTORY" },
      annualizedRealizedVolatility20: {
        value: null,
        status: "INSUFFICIENT_HISTORY",
      },
      relativeStrengthIndex14: { value: null, status: "INSUFFICIENT_HISTORY" },
    });
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("applies sourced split factors only to bars before the effective date", () => {
    const dates = businessDates(2);
    const result = normalizeOhlcv(
      input({
        expectedSessions: {
          dates,
          sourceId: "fixture-calendar",
          verificationStatus: "VERIFIED",
        },
        bars: [bar(dates[1], "50"), bar(dates[0], "100")],
        adjustment: {
          basis: "RAW",
          coverage: "COMPLETE",
          sourceId: "fixture-actions",
          sourceRecordId: "action-coverage",
          actions: [
            {
              effectiveDate: dates[1],
              kind: "SPLIT",
              priceFactor: "0.5",
              volumeFactor: "2",
              sourceRecordId: "split-2-for-1",
            },
          ],
        },
      }),
    );

    expect(result.adjustmentStatus).toBe("VERIFIED");
    expect(result.sessions[0].bar).toMatchObject({
      open: "50.00000000",
      high: "50.50000000",
      low: "49.50000000",
      close: "50.00000000",
      volume: "200.00000000",
      appliedAdjustmentRecordIds: ["split-2-for-1"],
    });
    expect(result.sessions[1].bar).toMatchObject({
      close: "50.00000000",
      volume: "100.00000000",
      appliedAdjustmentRecordIds: [],
    });
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("matches hand-calculated SMA, ATR, return quantiles and flat-market RSI", () => {
    const dates = businessDates(21);
    const bars = dates.map((date) => bar(date));
    const result = normalizeOhlcv(
      input({
        expectedSessions: {
          dates,
          sourceId: "fixture-calendar",
          verificationStatus: "NOT_VERIFIED",
        },
        bars,
      }),
    );
    const last = result.sessions.at(-1);

    expect(result.sessions[13].indicators.averageTrueRange14).toEqual({
      value: "2.00000000",
      status: "AVAILABLE",
    });
    expect(last?.indicators).toMatchObject({
      simpleMovingAverage20: { value: "100.00000000", status: "AVAILABLE" },
      averageTrueRange14: { value: "2.00000000", status: "AVAILABLE" },
      dailyReturn: { value: "0.00000000", status: "AVAILABLE" },
      annualizedRealizedVolatility20: {
        value: "0.00000000",
        status: "AVAILABLE",
      },
      dailyReturnQuantiles20: {
        value: { p05: "0.00000000", p50: "0.00000000", p95: "0.00000000" },
        status: "AVAILABLE",
      },
      relativeStrengthIndex14: { value: "50.00000000", status: "AVAILABLE" },
    });
  });

  it("uses linear-interpolated return quantiles with eight-place fixed precision", () => {
    const dates = businessDates(21);
    const bars = dates.map((date, index) => bar(date, String(100 + index)));
    const result = normalizeOhlcv(
      input({
        expectedSessions: {
          dates,
          sourceId: "fixture-calendar",
          verificationStatus: "NOT_VERIFIED",
        },
        bars,
      }),
    );

    expect(result.sessions.at(-1)?.indicators.dailyReturnQuantiles20).toEqual({
      value: {
        p05: "0.00847102",
        p50: "0.00913261",
        p95: "0.00990594",
      },
      status: "AVAILABLE",
    });
    expect(result.sessions.at(-1)?.indicators.dailyReturn.value).toBe(
      "0.00840336",
    );
  });

  it("annualizes the sample deviation of twenty returns using 252 sessions", () => {
    const dates = businessDates(21);
    const bars = dates.map((date, index) =>
      bar(date, index === 0 ? "100" : "110"),
    );
    const result = normalizeOhlcv(
      input({
        expectedSessions: {
          dates,
          sourceId: "fixture-calendar",
          verificationStatus: "NOT_VERIFIED",
        },
        bars,
      }),
    );

    expect(
      result.sessions.at(-1)?.indicators.annualizedRealizedVolatility20,
    ).toEqual({ value: "0.35496479", status: "AVAILABLE" });
  });

  it("does not guess an adjustment basis or apply actions to unknown-basis prices", () => {
    const dates = businessDates(3);
    const result = normalizeOhlcv(
      input({
        adjustment: {
          basis: "UNKNOWN",
          coverage: "UNKNOWN",
          sourceId: "unknown-adjustment-source",
          sourceRecordId: "unknown-adjustment-record",
          actions: [
            {
              effectiveDate: dates[1],
              kind: "SPLIT",
              priceFactor: "0.5",
              volumeFactor: "2",
              sourceRecordId: "known-split",
            },
          ],
        },
      }),
    );

    expect(result.sessions[0].bar?.close).toBe("100.00000000");
    expect(result.sessions[0].bar?.appliedAdjustmentRecordIds).toEqual([]);
    expect(result.adjustmentStatus).toBe("NOT_VERIFIED");
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("rejects duplicate dates, impossible OHLC ranges, and verified fixture data", () => {
    const dates = businessDates(2);
    expect(() =>
      normalizeOhlcv(input({ bars: [bar(dates[0]), bar(dates[0])] })),
    ).toThrow("duplicate_ohlcv_date");
    expect(() =>
      normalizeOhlcv(input({ bars: [{ ...bar(dates[0]), high: "99" }] })),
    ).toThrow("invalid_ohlcv_range");
    expect(() =>
      normalizeOhlcv(
        input({
          source: {
            sourceId: "fixture-prices",
            dataClass: "FIXTURE",
            verificationStatus: "VERIFIED",
          },
        }),
      ),
    ).toThrow("unverified_data_class_cannot_be_verified");
  });

  it("marks incomplete windows instead of filling them with invented values", () => {
    const dates = businessDates(3);
    const result = normalizeOhlcv(
      input({
        expectedSessions: {
          dates,
          sourceId: "fixture-calendar",
          verificationStatus: "NOT_VERIFIED",
        },
      }),
    );

    expect(result.sessions[2].indicators).toMatchObject({
      simpleMovingAverage20: { value: null, status: "INSUFFICIENT_HISTORY" },
      averageTrueRange14: { value: null, status: "INSUFFICIENT_HISTORY" },
      annualizedRealizedVolatility20: {
        value: null,
        status: "INSUFFICIENT_HISTORY",
      },
      dailyReturnQuantiles20: { value: null, status: "INSUFFICIENT_HISTORY" },
      relativeStrengthIndex14: { value: null, status: "INSUFFICIENT_HISTORY" },
    });
  });
});
