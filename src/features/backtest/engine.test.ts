import { describe, expect, it } from "vitest";

import { runBacktest } from "./engine";
import type { BacktestRunInput, BacktestSession } from "./engine";

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

function openAt(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function closeAt(date: string): number {
  return Date.parse(`${date}T06:30:00.000Z`);
}

function session(date: string, open = "100"): BacktestSession {
  const price = Number(open);
  return {
    date,
    openAtMs: openAt(date),
    closeAtMs: closeAt(date),
    bar: {
      availableAtMs: closeAt(date) + 60_000,
      open,
      high: String(price + 1),
      low: String(price - 1),
      close: open,
      volume: "100000",
      openPriceAvailableAtMs: openAt(date),
      sourceRecordId: `bar:${date}`,
    },
  };
}

function signal(
  id: string,
  sourceDate: string,
  side: "BUY" | "SELL",
  quantityShares = "100",
) {
  return {
    id,
    sourceDate,
    signalAtMs: closeAt(sourceDate) + 60_000,
    side,
    quantityShares,
  } as const;
}

function fixtureCostModel(
  overrides: Partial<BacktestRunInput["costModels"][number]> = {},
) {
  return {
    version: "fixture-cost-v1",
    sourceRecordId: "fixture-cost-record",
    effectiveFromDate: "2026-01-01",
    effectiveThroughDate: "2026-12-31",
    dataClass: "FIXTURE" as const,
    verificationStatus: "NOT_VERIFIED" as const,
    tickSize: "0.01",
    spreadBps: 0,
    slippageBps: 0,
    commissionBps: 0,
    fixedFeeMinor: "0",
    perShareFeeMinor: "0",
    maxParticipationBps: 10_000,
    ...overrides,
  };
}

function backtestInput(
  overrides: Partial<BacktestRunInput> = {},
): BacktestRunInput {
  const dates = businessDates(4);
  return {
    market: "JP",
    instrument: {
      instrumentId: "fixture-instrument",
      quoteCurrency: "JPY",
      tradingUnit: "100",
      sourceRecordId: "fixture-instrument-record",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
    },
    source: {
      sourceId: "fixture-price-source",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      executionPriceBasis: "RAW_UNADJUSTED",
    },
    calendar: {
      sourceId: "fixture-calendar",
      version: "fixture-calendar-v1",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      sessions: dates.map((date) => session(date)),
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
        sourceRecordId: `settlement:${tradeDate}`,
      })),
    },
    corporateActions: {
      sourceId: "fixture-actions",
      dataClass: "FIXTURE",
      coverage: "COMPLETE",
      verificationStatus: "NOT_VERIFIED",
      actions: [],
    },
    costModels: [fixtureCostModel()],
    initialCash: "1000000",
    signals: [],
    ...overrides,
  };
}

describe("runBacktest", () => {
  it("executes after the signal bar at the next session open with explicit costs", () => {
    const dates = businessDates(4);
    const input = backtestInput({
      calendar: {
        ...backtestInput().calendar,
        sessions: [
          session(dates[0]),
          session(dates[1]),
          session(dates[2], "110"),
          session(dates[3]),
        ],
      },
      costModels: [
        fixtureCostModel({
          spreadBps: 20,
          slippageBps: 10,
          commissionBps: 10,
          fixedFeeMinor: "1",
          perShareFeeMinor: "2",
        }),
      ],
      signals: [
        signal("buy-1", dates[0], "BUY"),
        signal("sell-1", dates[1], "SELL"),
      ],
    });
    const result = runBacktest(input);
    expect(runBacktest(input)).toEqual(result);
    expect(
      runBacktest({
        ...input,
        instrument: {
          verificationStatus: input.instrument.verificationStatus,
          dataClass: input.instrument.dataClass,
          sourceRecordId: input.instrument.sourceRecordId,
          tradingUnit: input.instrument.tradingUnit,
          quoteCurrency: input.instrument.quoteCurrency,
          instrumentId: input.instrument.instrumentId,
        },
      }),
    ).toEqual(result);

    expect(result.orders).toMatchObject([
      {
        signalId: "buy-1",
        executionDate: dates[1],
        executedAtMs: openAt(dates[1]),
        priceSourceRecordId: `bar:${dates[1]}`,
        costModelVersion: "fixture-cost-v1",
        costModelSourceRecordId: "fixture-cost-record",
        status: "FILLED",
        fillPrice: "100.20000000",
        fee: "212.00000000",
      },
      {
        signalId: "sell-1",
        executionDate: dates[2],
        executedAtMs: openAt(dates[2]),
        status: "FILLED",
        fillPrice: "109.78000000",
        fee: "212.00000000",
      },
    ]);
    expect(result.sessions[0].orderSignalIds).toEqual([]);
    expect(result.sessions[1].orderSignalIds).toEqual(["buy-1"]);
    expect(result.sessions[2].orderSignalIds).toEqual(["sell-1"]);
    expect(result.final).toMatchObject({
      settledCash: "1000534.00000000",
      positionShares: "0",
      equity: "1000534.00000000",
    });
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
    expect(result.resultClass).toBe("DEMO_ONLY");
  });

  it("does not carry an order across a missing next-session bar", () => {
    const dates = businessDates(3);
    const defaults = backtestInput();
    const result = runBacktest(
      backtestInput({
        calendar: {
          ...defaults.calendar,
          sessions: [
            session(dates[0]),
            { ...session(dates[1]), bar: null },
            session(dates[2]),
          ],
        },
        signals: [signal("buy-after-gap", dates[0], "BUY")],
      }),
    );

    expect(result.orders[0]).toMatchObject({
      executionDate: dates[1],
      status: "NOT_EXECUTED",
      reasonCode: "NEXT_SESSION_DATA_GAP",
    });
    expect(result.sessions[2].orderSignalIds).toEqual([]);
    expect(result.verificationReasons).toContain("MISSING_SESSION_BAR");
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("does not fill when the opening price was not available at the open", () => {
    const dates = businessDates(3);
    const defaults = backtestInput();
    const targetSession = session(dates[1]);
    const result = runBacktest(
      backtestInput({
        calendar: {
          ...defaults.calendar,
          sessions: [
            session(dates[0]),
            {
              ...targetSession,
              bar: {
                ...targetSession.bar!,
                openPriceAvailableAtMs: openAt(dates[1]) + 1,
              },
            },
            session(dates[2]),
          ],
        },
        signals: [signal("buy-late-open", dates[0], "BUY")],
      }),
    );

    expect(result.orders[0]).toMatchObject({
      status: "NOT_EXECUTED",
      reasonCode: "OPEN_PRICE_UNAVAILABLE_AT_OPEN",
    });
    expect(result.verificationReasons).toContain(
      "OPEN_PRICE_AVAILABILITY_UNKNOWN_OR_LATE",
    );
  });

  it("skips an open that occurs at the signal timestamp", () => {
    const dates = businessDates(4);
    const result = runBacktest(
      backtestInput({
        signals: [
          {
            ...signal("buy-at-open", dates[0], "BUY"),
            signalAtMs: openAt(dates[1]),
          },
        ],
      }),
    );

    expect(result.orders[0]).toMatchObject({
      status: "FILLED",
      executionDate: dates[2],
    });
  });

  it("rejects unaffordable buys and sales beyond the position without negative balances", () => {
    const dates = businessDates(4);
    const result = runBacktest(
      backtestInput({
        signals: [
          signal("a-large-buy", dates[0], "BUY", "20000"),
          signal("b-small-buy", dates[0], "BUY"),
          signal("oversell", dates[1], "SELL", "200"),
        ],
      }),
    );

    expect(result.orders).toMatchObject([
      {
        signalId: "a-large-buy",
        status: "REJECTED",
        reasonCode: "INSUFFICIENT_CASH",
      },
      {
        signalId: "b-small-buy",
        status: "FILLED",
        filledQuantityShares: "100",
      },
      {
        signalId: "oversell",
        status: "REJECTED",
        reasonCode: "INSUFFICIENT_POSITION",
      },
    ]);
    expect(
      BigInt(result.final.settledCash.replace(".00000000", "")),
    ).toBeGreaterThanOrEqual(BigInt(0));
    expect(BigInt(result.final.positionShares)).toBeGreaterThanOrEqual(
      BigInt(0),
    );
  });

  it("does not reuse sale proceeds before the configured settlement session", () => {
    const dates = businessDates(4);
    const result = runBacktest(
      backtestInput({
        initialCash: "10000",
        signals: [
          signal("initial-buy", dates[0], "BUY"),
          signal("a-sell", dates[1], "SELL"),
          signal("z-buy", dates[1], "BUY"),
        ],
      }),
    );

    expect(result.orders).toMatchObject([
      { signalId: "initial-buy", status: "FILLED" },
      {
        signalId: "a-sell",
        status: "FILLED",
        settlementAtMs: openAt(dates[3]),
        settlementRuleSourceRecordId: `settlement:${dates[2]}`,
      },
      {
        signalId: "z-buy",
        status: "REJECTED",
        reasonCode: "INSUFFICIENT_CASH",
      },
    ]);
    expect(result.sessions[2].saleReceivable).toBe("10000.00000000");
    expect(result.sessions[3]).toMatchObject({
      saleReceivable: "0.00000000",
      settledCash: "10000.00000000",
    });
  });

  it("does not fill sells without a timestamped settlement rule", () => {
    const dates = businessDates(4);
    const result = runBacktest(
      backtestInput({
        initialCash: "10000",
        settlementRules: null,
        signals: [
          signal("initial-buy", dates[0], "BUY"),
          signal("sell-without-settlement", dates[1], "SELL"),
        ],
      }),
    );

    expect(result.orders[1]).toMatchObject({
      status: "NOT_EXECUTED",
      reasonCode: "SETTLEMENT_RULE_MISSING",
    });
    expect(result.verificationReasons).toContain(
      "SETTLEMENT_RULES_UNAVAILABLE",
    );
  });

  it("caps total fills per session by volume participation", () => {
    const dates = businessDates(3);
    const defaults = backtestInput();
    const result = runBacktest(
      backtestInput({
        initialCash: "20000000",
        calendar: {
          ...defaults.calendar,
          sessions: dates.map((date) => ({
            ...session(date),
            bar: { ...session(date).bar!, volume: "100000" },
          })),
        },
        signals: [
          signal("buy-a", dates[0], "BUY", "60000"),
          signal("buy-b", dates[0], "BUY", "60000"),
        ],
      }),
    );

    expect(result.orders).toMatchObject([
      { signalId: "buy-a", status: "FILLED" },
      {
        signalId: "buy-b",
        status: "REJECTED",
        reasonCode: "INSUFFICIENT_BAR_LIQUIDITY",
      },
    ]);
    expect(result.sessions[1].positionShares).toBe("60000");
  });

  it("rejects a fixture calendar labeled as verified", () => {
    const defaults = backtestInput();
    expect(() =>
      runBacktest(
        backtestInput({
          calendar: {
            ...defaults.calendar,
            verificationStatus: "VERIFIED",
          },
        }),
      ),
    ).toThrow("unverified_calendar_cannot_be_verified");
  });

  it("updates holdings for a known split before the effective session opens", () => {
    const dates = businessDates(4);
    const defaults = backtestInput();
    const result = runBacktest(
      backtestInput({
        calendar: {
          ...defaults.calendar,
          sessions: dates.map((date) => session(date)),
        },
        corporateActions: {
          ...defaults.corporateActions,
          actions: [
            {
              kind: "SPLIT",
              effectiveDate: dates[2],
              knownAtMs: openAt(dates[2]) - 1,
              ratioNumerator: "2",
              ratioDenominator: "1",
              sourceRecordId: "split-2-for-1",
            },
          ],
        },
        signals: [signal("buy-before-split", dates[0], "BUY")],
      }),
    );

    expect(result.sessions[2]).toMatchObject({
      appliedCorporateActionIds: ["split-2-for-1"],
      positionShares: "200",
    });
    expect(result.final.positionShares).toBe("200");
  });

  it("records cash dividends as receivables and settles them on the payment timestamp", () => {
    const dates = businessDates(4);
    const defaults = backtestInput();
    const result = runBacktest(
      backtestInput({
        calendar: {
          ...defaults.calendar,
          sessions: dates.map((date) => session(date)),
        },
        corporateActions: {
          ...defaults.corporateActions,
          actions: [
            {
              kind: "CASH_DIVIDEND",
              effectiveDate: dates[2],
              knownAtMs: openAt(dates[2]) - 1,
              payableAtMs: openAt(dates[3]),
              grossAmountPerShare: "2",
              withholdingBps: 1_000,
              sourceRecordId: "dividend-2-yen",
            },
          ],
        },
        signals: [signal("buy-before-dividend", dates[0], "BUY")],
      }),
    );

    expect(result.sessions[2].dividendReceivable).toBe("180.00000000");
    expect(result.sessions[3]).toMatchObject({
      settledCash: "990180.00000000",
      dividendReceivable: "0.00000000",
    });
  });

  it("blocks execution for a split announced at its effective session open", () => {
    const dates = businessDates(4);
    const defaults = backtestInput();
    const result = runBacktest(
      backtestInput({
        corporateActions: {
          ...defaults.corporateActions,
          actions: [
            {
              kind: "SPLIT",
              effectiveDate: dates[2],
              knownAtMs: openAt(dates[2]),
              ratioNumerator: "2",
              ratioDenominator: "1",
              sourceRecordId: "late-split",
            },
          ],
        },
        signals: [
          signal("buy-before-late-split", dates[0], "BUY"),
          signal("sell-on-split", dates[1], "SELL"),
        ],
      }),
    );

    expect(result.orders[1]).toMatchObject({
      status: "NOT_EXECUTED",
      reasonCode: "CORPORATE_ACTION_POSITION_UNSUPPORTED",
    });
    expect(result.sessions[2].appliedCorporateActionIds).toEqual([]);
    expect(result.sessions[2].unappliedCorporateActionIds).toEqual([
      "late-split",
    ]);
    expect(result.final.equity).toBeNull();
    expect(result.verificationReasons).toContain("LATE_CORPORATE_ACTION");
    expect(result.verificationStatus).toBe("NOT_VERIFIED");
  });

  it("does not execute without an explicit cost model and produces a stable replay", () => {
    const dates = businessDates(4);
    const input = backtestInput({
      costModels: [],
      signals: [signal("buy-no-costs", dates[0], "BUY")],
    });

    expect(runBacktest(input)).toEqual(runBacktest(input));
    expect(runBacktest(input).orders[0]).toMatchObject({
      status: "NOT_EXECUTED",
      reasonCode: "COST_MODEL_UNAVAILABLE",
    });
    expect(runBacktest(input).verificationReasons).toContain(
      "COST_MODEL_UNAVAILABLE",
    );
  });

  it("does not fill outside the cost model effective period", () => {
    const dates = businessDates(3);
    const result = runBacktest(
      backtestInput({
        costModels: [
          fixtureCostModel({
            effectiveFromDate: dates[2],
            effectiveThroughDate: dates[2],
          }),
        ],
        signals: [signal("buy-outside-cost-period", dates[0], "BUY")],
      }),
    );

    expect(result.orders[0]).toMatchObject({
      status: "NOT_EXECUTED",
      reasonCode: "COST_MODEL_OUTSIDE_EFFECTIVE_PERIOD",
    });
    expect(result.verificationReasons).toContain(
      "COST_MODEL_MISSING_FOR_SESSION",
    );
  });

  it("uses the cost model version effective on each execution date", () => {
    const dates = businessDates(4);
    const result = runBacktest(
      backtestInput({
        costModels: [
          fixtureCostModel({
            version: "fee-v1",
            sourceRecordId: "fee-record-v1",
            effectiveFromDate: dates[0],
            effectiveThroughDate: dates[1],
            perShareFeeMinor: "1",
          }),
          fixtureCostModel({
            version: "fee-v2",
            sourceRecordId: "fee-record-v2",
            effectiveFromDate: dates[2],
            effectiveThroughDate: dates[3],
            perShareFeeMinor: "3",
          }),
        ],
        signals: [
          signal("buy-v1", dates[0], "BUY"),
          signal("sell-v2", dates[1], "SELL"),
        ],
      }),
    );

    expect(result.orders).toMatchObject([
      {
        signalId: "buy-v1",
        costModelVersion: "fee-v1",
        fee: "100.00000000",
      },
      {
        signalId: "sell-v2",
        costModelVersion: "fee-v2",
        fee: "300.00000000",
      },
    ]);
    expect(result.costModelVersions).toMatchObject([
      { version: "fee-v1", sourceRecordId: "fee-record-v1" },
      { version: "fee-v2", sourceRecordId: "fee-record-v2" },
    ]);
  });

  it("rejects signals dated before their completed source bar", () => {
    const dates = businessDates(3);
    expect(() =>
      runBacktest(
        backtestInput({
          signals: [
            {
              ...signal("early-buy", dates[0], "BUY"),
              signalAtMs: closeAt(dates[0]) - 1,
            },
          ],
        }),
      ),
    ).toThrow("signal_precedes_source_bar_close");
  });
});
