import { describe, expect, it } from "vitest";

import { runBacktest } from "@/features/backtest/engine";
import type { BacktestRunInput } from "@/features/backtest/engine";
import { normalizeOhlcv } from "@/features/quant/indicators";
import type { OhlcvBarInput, OhlcvInput } from "@/features/quant/indicators";

import {
  generateInitialStrategySignals,
  type InitialStrategyConfig,
} from "./initial-strategies";

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

function openAt(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function bar(
  date: string,
  close: string,
  volume = "100",
  availableAtMs: number | null = closeAt(date) + 60_000,
): OhlcvBarInput {
  const price = Number(close);
  return {
    date,
    availableAtMs,
    open: close,
    high: String(price + 1),
    low: String(Math.max(1, price - 1)),
    close,
    volume,
    sourceRecordId: `fixture-bar:${date}`,
  };
}

function ohlcvInput(
  dates: readonly string[],
  closes: readonly string[],
  volumes: readonly string[] = [],
  gapIndexes: readonly number[] = [],
  unknownAvailabilityIndexes: readonly number[] = [],
): OhlcvInput {
  return {
    market: "JP",
    source: {
      sourceId: "fixture-prices",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
    },
    expectedSessions: {
      sessions: dates.map((date) => ({ date, closeAtMs: closeAt(date) })),
      sourceId: "fixture-calendar",
      calendarVersion: "fixture-calendar-v1",
      verificationStatus: "NOT_VERIFIED",
    },
    adjustment: {
      basis: "RAW",
      coverage: "COMPLETE",
      sourceId: "fixture-actions",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      sourceRecordId: "fixture-action-coverage",
      actions: [],
    },
    indicatorWindows: { movingAverage: 3, returns: 3 },
    bars: dates.flatMap((date, index) =>
      gapIndexes.includes(index)
        ? []
        : [
            bar(
              date,
              closes[index],
              volumes[index] ?? "100",
              unknownAvailabilityIndexes.includes(index)
                ? null
                : closeAt(date) + 60_000,
            ),
          ],
    ),
  };
}

function run(
  dates: readonly string[],
  closes: readonly string[],
  config: InitialStrategyConfig,
  options: Readonly<{
    volumes?: readonly string[];
    gapIndexes?: readonly number[];
    unknownAvailabilityIndexes?: readonly number[];
    adjustmentActions?: OhlcvInput["adjustment"]["actions"];
    earningsEvidence?: unknown;
  }> = {},
) {
  const input = ohlcvInput(
    dates,
    closes,
    options.volumes,
    options.gapIndexes,
    options.unknownAvailabilityIndexes,
  );
  const series = normalizeOhlcv({
    ...input,
    adjustment: {
      ...input.adjustment,
      actions: options.adjustmentActions ?? input.adjustment.actions,
    },
  });
  return generateInitialStrategySignals({
    config,
    instrument: { instrumentId: "7203.T", tradingUnit: "100" },
    series,
    earningsEvidence: options.earningsEvidence,
  });
}

function breakoutConfig(
  overrides: Partial<
    Extract<InitialStrategyConfig, { kind: "TREND_VOLUME_BREAKOUT" }>
  > = {},
): Extract<InitialStrategyConfig, { kind: "TREND_VOLUME_BREAKOUT" }> {
  return {
    kind: "TREND_VOLUME_BREAKOUT",
    strategyId: "breakout",
    quantityShares: "100",
    stopLossBps: 5_000,
    maxHoldingSessions: 20,
    lookbackSessions: 2,
    volumeMultipleBps: 20_000,
    ...overrides,
  };
}

function meanReversionConfig(
  overrides: Partial<
    Extract<InitialStrategyConfig, { kind: "MEAN_REVERSION" }>
  > = {},
): Extract<InitialStrategyConfig, { kind: "MEAN_REVERSION" }> {
  return {
    kind: "MEAN_REVERSION",
    strategyId: "mean-reversion",
    quantityShares: "100",
    stopLossBps: 5_000,
    maxHoldingSessions: 30,
    oversoldRsi: 30,
    reboundRsi: 60,
    ...overrides,
  };
}

function earningsConfig(): Extract<
  InitialStrategyConfig,
  { kind: "POST_EARNINGS_DRIFT" }
> {
  return {
    kind: "POST_EARNINGS_DRIFT",
    strategyId: "earnings-drift",
    quantityShares: "100",
    stopLossBps: 5_000,
    maxHoldingSessions: 10,
    minimumSurpriseBps: 500,
    eventWindowSessions: 3,
  };
}

describe("initial strategies", () => {
  it("generates a volume-confirmed breakout and exits below the prior average", () => {
    const dates = businessDates(4);
    const result = run(dates, ["100", "101", "110", "103"], breakoutConfig(), {
      volumes: ["100", "100", "300", "100"],
    });

    expect(result.signals).toMatchObject([
      {
        sourceDate: dates[2],
        side: "BUY",
        signalAtMs: closeAt(dates[2]) + 60_000,
        reasonCode: "VOLUME_CONFIRMED_BREAKOUT",
      },
      {
        sourceDate: dates[3],
        side: "SELL",
        reasonCode: "CLOSE_BELOW_PRIOR_AVERAGE",
      },
    ]);
    expect(result.resultClass).toBe("DEMO_ONLY");
  });

  it("passes strategy signals to the backtest engine for next-open execution", () => {
    const dates = businessDates(4);
    const closes = ["100", "101", "110", "111"];
    const strategy = run(dates, closes, breakoutConfig(), {
      volumes: ["100", "100", "300", "100"],
    });
    const input: BacktestRunInput = {
      market: "JP",
      instrument: {
        instrumentId: "7203.T",
        quoteCurrency: "JPY",
        tradingUnit: "100",
        sourceRecordId: "fixture-instrument",
        dataClass: "FIXTURE",
        verificationStatus: "NOT_VERIFIED",
      },
      source: {
        sourceId: "fixture-execution-prices",
        dataClass: "FIXTURE",
        verificationStatus: "NOT_VERIFIED",
        executionPriceBasis: "RAW_UNADJUSTED",
      },
      calendar: {
        sourceId: "fixture-calendar",
        version: "fixture-calendar-v1",
        dataClass: "FIXTURE",
        verificationStatus: "NOT_VERIFIED",
        sessions: dates.map((date, index) => {
          const open = closes[index];
          const price = Number(open);
          return {
            date,
            openAtMs: openAt(date),
            closeAtMs: closeAt(date),
            bar: {
              availableAtMs: closeAt(date) + 60_000,
              openPriceAvailableAtMs: openAt(date),
              open,
              high: String(price + 1),
              low: String(price - 1),
              close: closes[index],
              volume: "100000",
              sourceRecordId: `fixture-execution-bar:${date}`,
            },
          };
        }),
      },
      corporateActions: {
        sourceId: "fixture-actions",
        dataClass: "FIXTURE",
        coverage: "COMPLETE",
        verificationStatus: "NOT_VERIFIED",
        actions: [],
      },
      settlementRules: {
        sourceId: "fixture-settlement-rules",
        version: "fixture-settlement-v1",
        dataClass: "FIXTURE",
        verificationStatus: "NOT_VERIFIED",
        records: dates.map((tradeDate, index) => ({
          tradeDate,
          settlementDate: dates[index + 1] ?? tradeDate,
          settlementAtMs: dates[index + 1]
            ? openAt(dates[index + 1])
            : closeAt(tradeDate) + 1,
          sourceRecordId: `fixture-settlement:${tradeDate}`,
        })),
      },
      costModels: [
        {
          version: "fixture-cost-v1",
          sourceRecordId: "fixture-cost-record",
          effectiveFromDate: dates[0],
          effectiveThroughDate: dates.at(-1)!,
          dataClass: "FIXTURE",
          verificationStatus: "NOT_VERIFIED",
          tickSize: "0.01",
          spreadBps: 0,
          slippageBps: 0,
          commissionBps: 0,
          fixedFeeMinor: "0",
          perShareFeeMinor: "0",
          maxParticipationBps: 10_000,
        },
      ],
      initialCash: "1000000",
      signals: strategy.signals,
    };
    const result = runBacktest(input);

    expect(result.orders).toMatchObject([
      {
        signalId: strategy.signals[0].id,
        executionDate: dates[3],
        executedAtMs: openAt(dates[3]),
        status: "FILLED",
      },
    ]);
    expect(result.final.positionShares).toBe("100");
    expect(result.resultClass).toBe("DEMO_ONLY");
  });

  it("compares breakout prices and volume on the current split-adjusted basis", () => {
    const dates = businessDates(4);
    const splitRecordId = "split:2026-01-07";
    const result = run(
      dates,
      ["200", "202", "103", "99"],
      breakoutConfig({ lookbackSessions: 2, volumeMultipleBps: 15_000 }),
      {
        volumes: ["100", "100", "300", "100"],
        adjustmentActions: [
          {
            effectiveDate: dates[2],
            knownAtMs: closeAt(dates[1]) + 60_000,
            kind: "SPLIT",
            priceFactor: "0.5",
            volumeFactor: "2",
            sourceRecordId: splitRecordId,
          },
        ],
      },
    );

    expect(result.signals).toMatchObject([
      {
        sourceDate: dates[2],
        side: "BUY",
        reasonCode: "VOLUME_CONFIRMED_BREAKOUT",
      },
      {
        sourceDate: dates[3],
        side: "SELL",
        reasonCode: "CLOSE_BELOW_PRIOR_AVERAGE",
      },
    ]);
    expect(result.signals[0].sourceRecordIds).toContain(splitRecordId);
    expect(result.signals[1].sourceRecordIds).toContain(splitRecordId);
  });

  it("does not emit a breakout when a split was not available at the bar close", () => {
    const dates = businessDates(4);
    const result = run(dates, ["200", "202", "103", "104"], breakoutConfig(), {
      volumes: ["100", "100", "300"],
      adjustmentActions: [
        {
          effectiveDate: dates[2],
          knownAtMs: closeAt(dates[2]) + 61_000,
          kind: "SPLIT",
          priceFactor: "0.5",
          volumeFactor: "2",
          sourceRecordId: "late-split",
        },
      ],
    });

    expect(result.signals).toEqual([]);
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
    expect(result.warnings).toContainEqual({
      date: dates[2],
      code: "ADJUSTMENT_EVIDENCE_INCOMPLETE",
    });
    expect(result.warnings).toContainEqual({
      date: dates[3],
      code: "ADJUSTMENT_EVIDENCE_INCOMPLETE",
    });
  });

  it("generates a mean-reversion entry and exits after the RSI rebound", () => {
    const dates = businessDates(35);
    const closes = [
      ...Array.from({ length: 15 }, (_, index) => String(114 - index)),
      ...Array.from({ length: 20 }, (_, index) => String(101 + index)),
    ];
    const result = run(dates, closes, meanReversionConfig());

    expect(result.signals[0]).toMatchObject({
      sourceDate: dates[14],
      side: "BUY",
      reasonCode: "RSI_OVERSOLD",
    });
    expect(result.signals.at(-1)).toMatchObject({
      side: "SELL",
      reasonCode: "RSI_REBOUND",
    });
    expect(result.signals).toHaveLength(2);
    expect(result.resultClass).toBe("DEMO_ONLY");
    expect(result.signals[0].sourceRecordIds).toHaveLength(15);
    expect(result.signals[0].sourceRecordIds).toContain(
      `fixture-bar:${dates[0]}`,
    );
  });

  it("does not use RSI history containing a bar with unknown availability", () => {
    const dates = businessDates(16);
    const closes = Array.from({ length: dates.length }, (_, index) =>
      String(114 - index),
    );
    const result = run(dates, closes, meanReversionConfig(), {
      unknownAvailabilityIndexes: [0],
    });

    expect(result.signals).toEqual([]);
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
    expect(result.warnings).toContainEqual({
      date: dates[15],
      code: "INDICATOR_HISTORY_UNAVAILABLE",
    });
  });

  it("uses only point-in-time earnings evidence for drift entry and negative-surprise exit", () => {
    const dates = businessDates(4);
    const entryPublishedAt = closeAt(dates[1]) + 60_000;
    const exitPublishedAt = closeAt(dates[2]) + 60_000;
    const result = run(dates, ["100", "101", "103", "97"], earningsConfig(), {
      earningsEvidence: {
        sourceId: "fixture-earnings",
        instrumentId: "7203.T",
        dataClass: "HISTORICAL",
        verificationStatus: "VERIFIED",
        coverage: "COMPLETE",
        events: [
          {
            eventId: "earnings-positive",
            publishedAtMs: entryPublishedAt,
            availableAtMs: entryPublishedAt,
            surpriseBps: 1_000,
            sourceRecordId: "earnings-record-1",
          },
          {
            eventId: "earnings-negative",
            publishedAtMs: exitPublishedAt,
            availableAtMs: exitPublishedAt,
            surpriseBps: -1_000,
            sourceRecordId: "earnings-record-2",
          },
        ],
      },
    });

    expect(result.signals).toMatchObject([
      {
        sourceDate: dates[2],
        side: "BUY",
        reasonCode: "POSITIVE_EARNINGS_DRIFT",
        sourceRecordIds: [
          "earnings-record-1",
          `fixture-bar:${dates[1]}`,
          `fixture-bar:${dates[2]}`,
        ],
      },
      {
        sourceDate: dates[3],
        side: "SELL",
        reasonCode: "NEGATIVE_EARNINGS_EXIT",
        sourceRecordIds: ["earnings-record-2", `fixture-bar:${dates[3]}`],
      },
    ]);
    expect(result.resultClass).toBe("DEMO_ONLY");
  });

  it("waits for close confirmation within the configured earnings window", () => {
    const dates = businessDates(4);
    const availableAtMs = closeAt(dates[0]) + 60_000;
    const result = run(
      dates,
      ["100", "100", "102", "101"],
      { ...earningsConfig(), eventWindowSessions: 2 },
      {
        earningsEvidence: {
          sourceId: "fixture-earnings",
          instrumentId: "7203.T",
          dataClass: "HISTORICAL",
          verificationStatus: "VERIFIED",
          coverage: "COMPLETE",
          events: [
            {
              eventId: "earnings-positive",
              publishedAtMs: availableAtMs,
              availableAtMs,
              surpriseBps: 1_000,
              sourceRecordId: "earnings-record",
            },
          ],
        },
      },
    );

    expect(result.signals).toMatchObject([
      {
        sourceDate: dates[2],
        side: "BUY",
        reasonCode: "POSITIVE_EARNINGS_DRIFT",
      },
    ]);
  });

  it("reports an earnings event when no positive drift appears before expiry", () => {
    const dates = businessDates(4);
    const availableAtMs = closeAt(dates[0]) + 60_000;
    const result = run(
      dates,
      ["100", "100", "99", "98"],
      { ...earningsConfig(), eventWindowSessions: 2 },
      {
        earningsEvidence: {
          sourceId: "fixture-earnings",
          instrumentId: "7203.T",
          dataClass: "HISTORICAL",
          verificationStatus: "VERIFIED",
          coverage: "COMPLETE",
          events: [
            {
              eventId: "earnings-positive",
              publishedAtMs: availableAtMs,
              availableAtMs,
              surpriseBps: 1_000,
              sourceRecordId: "earnings-record",
            },
          ],
        },
      },
    );

    expect(result.signals).toEqual([]);
    expect(result.warnings).toContainEqual({
      date: dates[3],
      code: "EARNINGS_DRIFT_NOT_CONFIRMED",
    });
  });

  it("does not emit earnings signals without evidence coverage", () => {
    const dates = businessDates(4);
    const result = run(dates, ["100", "101", "102", "103"], earningsConfig());

    expect(result.signals).toEqual([]);
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
    expect(result.warnings).toContainEqual({
      date: null,
      code: "EARNINGS_EVIDENCE_MISSING",
    });
  });

  it("rejects earnings coverage scoped to a different instrument", () => {
    const dates = businessDates(4);
    const result = run(dates, ["100", "101", "102", "103"], earningsConfig(), {
      earningsEvidence: {
        sourceId: "fixture-earnings",
        instrumentId: "AAPL",
        dataClass: "HISTORICAL",
        verificationStatus: "VERIFIED",
        coverage: "COMPLETE",
        events: [],
      },
    });

    expect(result.signals).toEqual([]);
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
    expect(result.warnings).toContainEqual({
      date: null,
      code: "EARNINGS_INSTRUMENT_MISMATCH",
    });
  });

  it("rejects earnings evidence available before publication", () => {
    const dates = businessDates(2);
    const result = () =>
      run(dates, ["100", "101"], earningsConfig(), {
        earningsEvidence: {
          sourceId: "fixture-earnings",
          instrumentId: "7203.T",
          dataClass: "HISTORICAL",
          verificationStatus: "VERIFIED",
          coverage: "COMPLETE",
          events: [
            {
              eventId: "earnings-event",
              publishedAtMs: closeAt(dates[0]) + 2,
              availableAtMs: closeAt(dates[0]) + 1,
              surpriseBps: 1_000,
              sourceRecordId: "earnings-record",
            },
          ],
        },
      });

    expect(result).toThrow("earnings_available_before_publication");
  });

  it("does not create a breakout across a price-data gap", () => {
    const dates = businessDates(4);
    const result = run(dates, ["100", "101", "100", "110"], breakoutConfig(), {
      gapIndexes: [2],
      volumes: ["100", "100", "100", "300"],
    });

    expect(result.signals).toEqual([]);
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
    expect(result.warnings).toContainEqual({
      date: dates[2],
      code: "SESSION_GAP",
    });
    expect(result.warnings).toContainEqual({
      date: dates[3],
      code: "LOOKBACK_DATA_GAP",
    });
  });

  it("fails safe after an unknown-availability bar while a position is open", () => {
    const dates = businessDates(5);
    const result = run(
      dates,
      ["100", "101", "110", "111", "112"],
      breakoutConfig(),
      {
        volumes: ["100", "100", "300", "100", "100"],
        unknownAvailabilityIndexes: [3],
      },
    );

    expect(result.signals).toMatchObject([
      {
        sourceDate: dates[2],
        side: "BUY",
        reasonCode: "VOLUME_CONFIRMED_BREAKOUT",
      },
      {
        sourceDate: dates[4],
        side: "SELL",
        reasonCode: "STOP_DATA_UNAVAILABLE",
      },
    ]);
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("emits a close-to-close stop after the configured daily loss", () => {
    const dates = businessDates(16);
    const closes = [
      ...Array.from({ length: 15 }, (_, index) => String(114 - index)),
      "90",
    ];
    const result = run(
      dates,
      closes,
      meanReversionConfig({ stopLossBps: 500 }),
    );

    expect(result.signals).toMatchObject([
      { sourceDate: dates[14], side: "BUY", reasonCode: "RSI_OVERSOLD" },
      {
        sourceDate: dates[15],
        side: "SELL",
        reasonCode: "CLOSE_TO_CLOSE_STOP",
      },
    ]);
  });

  it("rejects out-of-range parameters, unknown keys, and quantities outside the trading unit", () => {
    const dates = businessDates(3);
    const series = normalizeOhlcv(ohlcvInput(dates, ["100", "101", "102"]));
    const instrumentWithUnknownKey = {
      instrumentId: "7203.T",
      tradingUnit: "100",
      unexpected: true,
    };

    expect(() =>
      generateInitialStrategySignals({
        config: { ...breakoutConfig(), volumeMultipleBps: 9_999 },
        instrument: { instrumentId: "7203.T", tradingUnit: "100" },
        series,
      }),
    ).toThrow();
    expect(() =>
      generateInitialStrategySignals({
        config: { ...breakoutConfig(), unexpected: true },
        instrument: { instrumentId: "7203.T", tradingUnit: "100" },
        series,
      }),
    ).toThrow();
    expect(() =>
      generateInitialStrategySignals({
        config: { ...breakoutConfig(), quantityShares: "150" },
        instrument: { instrumentId: "7203.T", tradingUnit: "100" },
        series,
      }),
    ).toThrow("invalid_strategy_instrument_or_quantity");
    expect(() =>
      generateInitialStrategySignals({
        config: breakoutConfig(),
        instrument: instrumentWithUnknownKey,
        series,
      }),
    ).toThrow();
  });

  it("replays identical input deterministically", () => {
    const dates = businessDates(5);
    const series = normalizeOhlcv(
      ohlcvInput(
        dates,
        ["100", "101", "110", "111", "103"],
        ["100", "100", "300", "100", "100"],
      ),
    );
    const input = {
      config: breakoutConfig(),
      instrument: { instrumentId: "7203.T", tradingUnit: "100" },
      series,
    };

    expect(generateInitialStrategySignals(input)).toEqual(
      generateInitialStrategySignals(input),
    );
  });
});
