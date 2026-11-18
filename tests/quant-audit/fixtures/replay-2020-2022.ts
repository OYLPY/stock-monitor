import type { BacktestRunInput } from "@/features/backtest/engine";
import type { runStressSensitivity } from "@/features/validation/stress-test";

// Fixed synthetic vector for replay checks; it is not market history.
const dates = [
  "2020-03-16",
  "2020-03-17",
  "2020-03-18",
  "2020-03-19",
  "2022-06-13",
  "2022-06-14",
  "2022-06-15",
  "2022-06-16",
] as const;

const openAt = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const closeAt = (date: string) => Date.parse(`${date}T06:30:00.000Z`);

const backtest: BacktestRunInput = {
  market: "JP",
  instrument: {
    instrumentId: "fixture-jp-equity",
    quoteCurrency: "JPY",
    tradingUnit: "100",
    sourceRecordId: "fixture-instrument",
    dataClass: "FIXTURE",
    verificationStatus: "NOT_VERIFIED",
  },
  source: {
    sourceId: "fixture-prices",
    dataClass: "FIXTURE",
    verificationStatus: "NOT_VERIFIED",
    executionPriceBasis: "RAW_UNADJUSTED",
  },
  calendar: {
    sourceId: "fixture-calendar",
    version: "p12-04-fixture-calendar-v1",
    dataClass: "FIXTURE",
    verificationStatus: "NOT_VERIFIED",
    sessions: dates.map((date, index) => {
      const open = [100, 101, 103, 102, 200, 199, 202, 201][index];
      if (open === undefined) throw new RangeError("missing_fixture_price");
      return {
        date,
        openAtMs: openAt(date),
        closeAtMs: closeAt(date),
        bar: {
          availableAtMs: closeAt(date) + 60_000,
          open: String(open),
          high: String(open + 2),
          low: String(open - 2),
          close: String(open),
          volume: "100000",
          openPriceAvailableAtMs: openAt(date),
          sourceRecordId: `fixture-bar:${date}`,
        },
      };
    }),
  },
  corporateActions: {
    sourceId: "fixture-corporate-actions",
    dataClass: "FIXTURE",
    coverage: "COMPLETE",
    verificationStatus: "NOT_VERIFIED",
    actions: [],
  },
  settlementRules: {
    sourceId: "fixture-settlement-rules",
    version: "p12-04-fixture-settlement-v1",
    dataClass: "FIXTURE",
    verificationStatus: "NOT_VERIFIED",
    records: dates.map((date, index) => {
      const settlementDate = dates[index + 1] ?? date;
      return {
        tradeDate: date,
        settlementDate,
        settlementAtMs: dates[index + 1]
          ? openAt(settlementDate)
          : closeAt(date) + 1,
        sourceRecordId: `fixture-settlement:${date}`,
      };
    }),
  },
  costModels: [
    {
      version: "p12-04-fixture-cost-v1",
      sourceRecordId: "fixture-cost-model",
      effectiveFromDate: "2020-01-01",
      effectiveThroughDate: "2022-12-31",
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
  signals: [
    {
      id: "fixture-2020-buy",
      sourceDate: dates[0],
      signalAtMs: closeAt(dates[0]) + 60_000,
      side: "BUY",
      quantityShares: "100",
    },
    {
      id: "fixture-2020-sell",
      sourceDate: dates[1],
      signalAtMs: closeAt(dates[1]) + 60_000,
      side: "SELL",
      quantityShares: "100",
    },
    {
      id: "fixture-2022-buy",
      sourceDate: dates[4],
      signalAtMs: closeAt(dates[4]) + 60_000,
      side: "BUY",
      quantityShares: "100",
    },
    {
      id: "fixture-2022-sell",
      sourceDate: dates[5],
      signalAtMs: closeAt(dates[5]) + 60_000,
      side: "SELL",
      quantityShares: "100",
    },
  ],
};

export const replayInput = {
  backtest,
  reportingCurrency: "USD",
  coverage: [
    {
      year: 2020,
      sourceRecordId: "fixture-2020-coverage",
      coverage: "INCOMPLETE",
      firstSessionDate: dates[0],
      lastSessionDate: dates[3],
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      parameterSelection: "UNKNOWN",
    },
    {
      year: 2022,
      sourceRecordId: "fixture-2022-coverage",
      coverage: "INCOMPLETE",
      firstSessionDate: dates[4],
      lastSessionDate: dates[7],
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      parameterSelection: "UNKNOWN",
    },
  ],
  fxObservations: dates.map((date) => ({
    date,
    baseCurrency: "JPY",
    quoteCurrency: "USD",
    rate: "0.0067",
    marketAtMs: closeAt(date),
    availableAtMs: closeAt(date),
    validFromMs: openAt(date),
    validUntilMs: closeAt(date),
    sourceRecordId: `fixture-fx:${date}`,
    dataClass: "FIXTURE",
    verificationStatus: "NOT_VERIFIED",
  })),
  scenarios: [
    {
      id: "fixture-adverse-cost-and-fx",
      version: "p12-04-fixture-stress-v1",
      sourceRecordId: "fixture-stress-scenario",
      dataClass: "FIXTURE",
      verificationStatus: "NOT_VERIFIED",
      commissionBpsIncrease: 50,
      spreadBpsIncrease: 25,
      slippageBpsIncrease: 25,
      gapReserveBps: 50,
      terminalFxShockBps: -500,
    },
  ],
} satisfies Parameters<typeof runStressSensitivity>[0];

export const replayExpected = {
  baselineInputHashSha256:
    "fe90e8347ba96579669921f02cc6fc4e09e51d44da6934fec84bf6d3c6192100",
  baselineFinalEquity: "1000500.00000000",
  scenarioHashSha256:
    "82a07ee02e1eb3baf009fd8e1a99b0f493120d847b0c317b4d5e07e6fb05bc6f",
  scenarioFees: "305.00000000",
  scenarioFinalEquity: "999663.00000000",
} as const;
