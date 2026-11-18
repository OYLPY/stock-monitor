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

function closeAt(date: string): number {
  return Date.parse(`${date}T06:30:00.000Z`);
}

function bar(
  date: string,
  close = "100",
  availableAtMs: number | null = closeAt(date),
): OhlcvBarInput {
  const closeValue = Number(close);
  return {
    date,
    availableAtMs,
    open: close,
    high: String(closeValue + 1),
    low: String(closeValue - 1),
    close,
    volume: "100",
    sourceRecordId: `quote:${date}`,
  };
}

function calendar(dates: readonly string[]) {
  return {
    sessions: dates.map((date) => ({
      date,
      closeAtMs: closeAt(date),
    })),
    sourceId: "fixture-calendar",
    calendarVersion: "fixture-calendar-v1",
    verificationStatus: "NOT_VERIFIED" as const,
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
    expectedSessions: calendar(dates),
    adjustment: {
      basis: "RAW",
      coverage: "COMPLETE",
      sourceId: "fixture-actions",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      sourceRecordId: "fixture-action-coverage",
      actions: [],
    },
    indicatorWindows: { movingAverage: 20, returns: 20 },
    bars: dates.map((date) => bar(date)),
    ...overrides,
  };
}

describe("normalizeOhlcv", () => {
  it("maps gaps, resets indicator windows, and does not bridge returns", () => {
    const dates = businessDates(26);
    const bars = dates.flatMap((date, index) =>
      index === 15 ? [] : [bar(date, index < 15 ? "100" : "110")],
    );
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars,
      }),
    );

    expect(result.sessions[15]).toMatchObject({
      sessionIndex: 15,
      status: "GAP",
      verificationStatus: "NOT_VERIFIED",
      bar: null,
    });
    expect(result.sessions[16].indicators.dailyReturn).toEqual({
      value: null,
      status: "GAP",
    });
    expect(result.sessions.at(-1)?.indicators).toMatchObject({
      simpleMovingAverage: { value: null, status: "INSUFFICIENT_HISTORY" },
      averageTrueRange14: { value: null, status: "INSUFFICIENT_HISTORY" },
      realizedVolatility: { value: null, status: "INSUFFICIENT_HISTORY" },
      relativeStrengthIndex14: {
        value: null,
        status: "INSUFFICIENT_HISTORY",
      },
    });
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("applies a sourced split to indicator history only on or after its effective date", () => {
    const dates = businessDates(2);
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars: [bar(dates[1], "50"), bar(dates[0], "100")],
        adjustment: {
          basis: "RAW",
          coverage: "COMPLETE",
          sourceId: "fixture-actions",
          dataClass: "FIXTURE",
          verificationStatus: "NOT_VERIFIED",
          sourceRecordId: "action-coverage",
          actions: [
            {
              effectiveDate: dates[1],
              knownAtMs: calendar(dates).sessions[0].closeAtMs,
              kind: "SPLIT",
              priceFactor: "0.5",
              volumeFactor: "2",
              sourceRecordId: "split-2-for-1",
            },
          ],
        },
      }),
    );

    expect(result.sessions[0].bar).toMatchObject({
      close: "100.00000000",
      volume: "100.00000000",
    });
    expect(result.sessions[0].adjustmentRecordIdsAppliedToIndicators).toEqual(
      [],
    );
    expect(result.sessions[1].bar).toMatchObject({
      close: "50.00000000",
      volume: "100.00000000",
    });
    expect(result.sessions[1].adjustmentRecordIdsAppliedToIndicators).toEqual([
      "split-2-for-1",
    ]);
    expect(result.sessions[1].indicators.dailyReturn).toEqual({
      value: "0.00000000",
      status: "AVAILABLE",
    });
    expect(result.adjustmentStatus).toBe("NOT_VERIFIED");
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("uses completed-bar availability as signal time and requires it for verification", () => {
    const dates = businessDates(2);
    const availableAtMs = closeAt(dates[1]) + 30_000;
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars: [bar(dates[0]), bar(dates[1], "100", availableAtMs)],
      }),
    );
    const unknownAvailability = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars: [bar(dates[0]), bar(dates[1], "100", null)],
      }),
    );

    expect(result.sessions[1]).toMatchObject({
      signalAtMs: availableAtMs,
      bar: { availableAtMs },
    });
    expect(unknownAvailability.sessions[1]).toMatchObject({
      signalAtMs: null,
      verificationStatus: "NOT_VERIFIED",
      bar: { availableAtMs: null },
    });
    expect(() =>
      normalizeOhlcv(
        input({
          expectedSessions: calendar(dates),
          bars: [bar(dates[0]), bar(dates[1], "100", closeAt(dates[1]) - 1)],
        }),
      ),
    ).toThrow("invalid_bar_availability_time");
  });

  it("applies a split known after close when it is known by delayed bar availability", () => {
    const dates = businessDates(2);
    const closeTime = closeAt(dates[1]);
    const signalTime = closeTime + 30_000;
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars: [bar(dates[0]), bar(dates[1], "50", signalTime)],
        adjustment: {
          basis: "RAW",
          coverage: "COMPLETE",
          sourceId: "fixture-actions",
          dataClass: "FIXTURE",
          verificationStatus: "NOT_VERIFIED",
          sourceRecordId: "action-coverage",
          actions: [
            {
              effectiveDate: dates[1],
              knownAtMs: closeTime + 1,
              kind: "SPLIT",
              priceFactor: "0.5",
              volumeFactor: "2",
              sourceRecordId: "split-known-after-close",
            },
          ],
        },
      }),
    );

    expect(result.sessions[1]).toMatchObject({
      signalAtMs: signalTime,
      adjustmentRecordIdsAppliedToIndicators: ["split-known-after-close"],
      indicators: { dailyReturn: { value: "0.00000000" } },
    });
    expect(result.adjustmentStatus).toBe("NOT_VERIFIED");
  });

  it("matches hand-calculated SMA, ATR, daily returns and flat-market RSI", () => {
    const dates = businessDates(21);
    const bars = dates.map((date) => bar(date));
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars,
      }),
    );
    const last = result.sessions.at(-1);

    expect(result.sessions[13].indicators.averageTrueRange14).toMatchObject({
      value: null,
      status: "INSUFFICIENT_HISTORY",
    });
    expect(result.sessions[14].indicators.averageTrueRange14).toEqual({
      value: "2.00000000",
      status: "AVAILABLE",
    });
    expect(last?.indicators).toMatchObject({
      simpleMovingAverage: { value: "100.00000000", status: "AVAILABLE" },
      averageTrueRange14: { value: "2.00000000", status: "AVAILABLE" },
      dailyReturn: { value: "0.00000000", status: "AVAILABLE" },
      dailyLogReturn: { value: "0.00000000", status: "AVAILABLE" },
      realizedVolatility: { value: "0.00000000", status: "AVAILABLE" },
      logReturnQuantiles: {
        value: { p05: "0.00000000", p50: "0.00000000", p95: "0.00000000" },
        status: "AVAILABLE",
      },
      relativeStrengthIndex14: { value: "50.00000000", status: "AVAILABLE" },
    });
  });

  it("computes log-return quantiles with linear interpolation and fixed precision", () => {
    const dates = businessDates(21);
    const bars = dates.map((date, index) => bar(date, String(100 + index)));
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars,
      }),
    );

    expect(result.sessions.at(-1)?.indicators.logReturnQuantiles).toEqual({
      value: {
        p05: "0.00843534",
        p50: "0.00909116",
        p95: "0.00985720",
      },
      status: "AVAILABLE",
    });
    expect(result.sessions.at(-1)?.indicators.dailyReturn.value).toBe(
      "0.00840336",
    );
    expect(result.sessions.at(-1)?.indicators.dailyLogReturn.value).toBe(
      "0.00836825",
    );
  });

  it("uses sample standard deviation of log returns without implicit annualization", () => {
    const dates = businessDates(21);
    const bars = dates.map((date, index) =>
      bar(date, index === 0 ? "100" : "110"),
    );
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
        bars,
      }),
    );

    expect(result.sessions.at(-1)?.indicators.realizedVolatility).toEqual({
      value: "0.02131200",
      status: "AVAILABLE",
    });
  });

  it("does not apply a split adjustment before it is known or after unknown basis", () => {
    const dates = businessDates(3);
    const result = normalizeOhlcv(
      input({
        adjustment: {
          basis: "UNKNOWN",
          coverage: "UNKNOWN",
          sourceId: "unknown-adjustment-source",
          dataClass: "NOT_VERIFIED",
          verificationStatus: "NOT_VERIFIED",
          sourceRecordId: "unknown-adjustment-record",
          actions: [
            {
              effectiveDate: dates[1],
              knownAtMs: calendar(dates).sessions[0].closeAtMs,
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
    expect(result.sessions[1].adjustmentRecordIdsAppliedToIndicators).toEqual(
      [],
    );
    expect(result.adjustmentStatus).toBe("NOT_VERIFIED");
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("refuses retrospective split data and never labels fixtures verified", () => {
    const dates = businessDates(3);
    const result = normalizeOhlcv(
      input({
        adjustment: {
          basis: "RAW",
          coverage: "COMPLETE",
          sourceId: "fixture-actions",
          dataClass: "FIXTURE",
          verificationStatus: "NOT_VERIFIED",
          sourceRecordId: "fixture-action-coverage",
          actions: [
            {
              effectiveDate: dates[1],
              knownAtMs: calendar(dates).sessions[2].closeAtMs,
              kind: "SPLIT",
              priceFactor: "0.5",
              volumeFactor: "2",
              sourceRecordId: "late-split",
            },
          ],
        },
      }),
    );

    expect(result.sessions[0].verificationStatus).toBe("NOT_VERIFIED");
    expect(result.sessions[1].verificationStatus).toBe("NOT_VERIFIED");
    expect(
      result.sessions.every(
        ({ adjustmentRecordIdsAppliedToIndicators }) =>
          adjustmentRecordIdsAppliedToIndicators.length === 0,
      ),
    ).toBe(true);
    expect(result.adjustmentStatus).toBe("NOT_VERIFIED");
  });

  it("rejects duplicate records, impossible OHLC ranges, and unsupported windows", () => {
    const dates = businessDates(2);
    expect(() =>
      normalizeOhlcv(input({ bars: [bar(dates[0]), bar(dates[0])] })),
    ).toThrow("duplicate_ohlcv_date");
    expect(() =>
      normalizeOhlcv(input({ bars: [{ ...bar(dates[0]), high: "99" }] })),
    ).toThrow("invalid_ohlcv_range");
    expect(() =>
      normalizeOhlcv(
        input({ indicatorWindows: { movingAverage: 0, returns: 20 } }),
      ),
    ).toThrow("invalid_indicator_window");
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

  it("marks incomplete indicator windows instead of filling them", () => {
    const dates = businessDates(3);
    const result = normalizeOhlcv(
      input({
        expectedSessions: calendar(dates),
      }),
    );

    expect(result.sessions[2].indicators).toMatchObject({
      simpleMovingAverage: { value: null, status: "INSUFFICIENT_HISTORY" },
      averageTrueRange14: { value: null, status: "INSUFFICIENT_HISTORY" },
      realizedVolatility: { value: null, status: "INSUFFICIENT_HISTORY" },
      logReturnQuantiles: { value: null, status: "INSUFFICIENT_HISTORY" },
      relativeStrengthIndex14: {
        value: null,
        status: "INSUFFICIENT_HISTORY",
      },
    });
  });
});
