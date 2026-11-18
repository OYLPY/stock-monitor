import { createHash } from "node:crypto";

import {
  convertMoney,
  moneyFromDecimal,
  parseFixedDecimal,
  parseFxRate,
} from "@/domain/primitives";
import type { CurrencyCode, Money, RoundingMode } from "@/domain/primitives";
import { runBacktest } from "@/features/backtest/engine";
import type {
  BacktestRunInput,
  BacktestRunResult,
} from "@/features/backtest/engine";
import type {
  OhlcvDataClass,
  VerificationStatus,
} from "@/features/quant/indicators";

const BPS = BigInt(10_000);
const ATOMS = BigInt(100_000_000);
const STRESS_YEARS = [2020, 2022] as const;

export type StressYear = (typeof STRESS_YEARS)[number];

export type StressWindowEvidence = Readonly<{
  year: StressYear;
  sourceRecordId: string;
  coverage: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  firstSessionDate: string;
  lastSessionDate: string;
  dataClass: OhlcvDataClass;
  verificationStatus: VerificationStatus;
  parameterSelection: "INCLUDED" | "EXCLUDED" | "UNKNOWN";
}>;

export type StressFxObservation = Readonly<{
  date: string;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: string;
  marketAtMs: number;
  availableAtMs: number;
  validFromMs: number;
  validUntilMs: number;
  sourceRecordId: string;
  dataClass: OhlcvDataClass;
  verificationStatus: VerificationStatus;
}>;

export type StressScenario = Readonly<{
  id: string;
  version: string;
  sourceRecordId: string;
  dataClass: OhlcvDataClass;
  verificationStatus: VerificationStatus;
  commissionBpsIncrease: number;
  spreadBpsIncrease: number;
  slippageBpsIncrease: number;
  gapReserveBps: number;
  maxParticipationBps?: number;
  terminalFxShockBps: number;
}>;

export type StressMetrics = Readonly<{
  currency: CurrencyCode;
  initialEquity: string;
  finalEquity: string | null;
  netReturnBps: string | null;
  maxDrawdownBps: string | null;
  fees: string;
  filledOrderCount: number;
  rejectedOrderCount: number;
}>;

export type StressWindowResult = Readonly<{
  year: StressYear;
  sourceRecordId: string | null;
  coverage: StressWindowEvidence["coverage"] | null;
  firstSessionDate: string | null;
  lastSessionDate: string | null;
  status: "VERIFIED" | "NOT_VERIFIED";
  reasonCodes: readonly string[];
  parameterSelection: StressWindowEvidence["parameterSelection"] | null;
  independentStress: boolean | null;
  metrics: Readonly<{
    reportingCurrency: CurrencyCode;
    feeCurrency: CurrencyCode;
    initialEquityMinor: string;
    finalEquityMinor: string;
    netReturnBps: string;
    maxDrawdownBps: string;
    fees: string;
    filledOrderCount: number;
    rejectedOrderCount: number;
  }> | null;
}>;

export type StressScenarioResult = Readonly<{
  scenario: StressScenario;
  scenarioHashSha256: string;
  backtest: BacktestRunResult;
  metrics: StressMetrics;
  executionChanged: boolean;
  historicalWindows: readonly StressWindowResult[];
}>;

export type StressTestReport = Readonly<{
  baseline: Readonly<{
    backtest: BacktestRunResult;
    metrics: StressMetrics;
    historicalWindows: readonly StressWindowResult[];
  }>;
  scenarios: readonly StressScenarioResult[];
}>;

function decimalAtoms(value: string): bigint {
  const { mantissa, scale } = parseFixedDecimal(value);
  return mantissa * BigInt(10) ** BigInt(8 - scale);
}

function formatAtoms(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}${absolute / ATOMS}.${(absolute % ATOMS)
    .toString()
    .padStart(8, "0")}`;
}

function basisPoints(numerator: bigint, denominator: bigint): string | null {
  return denominator > BigInt(0)
    ? ((numerator * BPS) / denominator).toString()
    : null;
}

function maximumDrawdownBps(values: readonly bigint[]): string | null {
  if (values.length === 0 || values.some((value) => value <= BigInt(0))) {
    return null;
  }
  let peak = values[0];
  let maximum = BigInt(0);
  for (const value of values.slice(1)) {
    if (value > peak) peak = value;
    else if (value < peak) {
      const drawdown = ((peak - value) * BPS) / peak;
      if (drawdown > maximum) maximum = drawdown;
    }
  }
  return maximum.toString();
}

function metricsForRun(
  initialEquity: string,
  currency: CurrencyCode,
  result: BacktestRunResult,
): StressMetrics {
  const fees = result.orders.reduce(
    (total, order) =>
      order.status === "FILLED" && order.fee
        ? total + decimalAtoms(order.fee)
        : total,
    BigInt(0),
  );
  const equities = result.sessions.map(({ closeEquity }) =>
    closeEquity === null ? null : decimalAtoms(closeEquity),
  );
  const initialAtoms = decimalAtoms(initialEquity);
  const allEquities = equities.every((equity) => equity !== null)
    ? [
        initialAtoms,
        ...equities.filter((equity): equity is bigint => equity !== null),
      ]
    : [];
  const finalEquity = result.final.equity;
  const finalAtoms = finalEquity === null ? null : decimalAtoms(finalEquity);

  return {
    currency,
    initialEquity,
    finalEquity,
    netReturnBps:
      finalAtoms === null
        ? null
        : basisPoints(finalAtoms - initialAtoms, initialAtoms),
    maxDrawdownBps: maximumDrawdownBps(allEquities),
    fees: formatAtoms(fees),
    filledOrderCount: result.orders.filter(({ status }) => status === "FILLED")
      .length,
    rejectedOrderCount: result.orders.filter(
      ({ status }) => status === "REJECTED",
    ).length,
  };
}

function executionChanged(
  baseline: BacktestRunResult,
  scenario: BacktestRunResult,
): boolean {
  return (
    baseline.orders.length !== scenario.orders.length ||
    baseline.orders.some((order, index) => {
      const candidate = scenario.orders[index];
      return (
        candidate === undefined ||
        order.signalId !== candidate.signalId ||
        order.status !== candidate.status ||
        order.executionDate !== candidate.executionDate ||
        order.filledQuantityShares !== candidate.filledQuantityShares
      );
    })
  );
}

function validateScenario(
  scenario: StressScenario,
  seenIds: Set<string>,
  input: BacktestRunInput,
  reportingCurrency: CurrencyCode,
): void {
  if (
    !scenario.id.trim() ||
    seenIds.has(scenario.id) ||
    !scenario.version.trim() ||
    !scenario.sourceRecordId.trim()
  ) {
    throw new RangeError("invalid_stress_scenario_identity");
  }
  if (
    scenario.verificationStatus === "VERIFIED" &&
    scenario.dataClass !== "REAL" &&
    scenario.dataClass !== "DELAYED" &&
    scenario.dataClass !== "HISTORICAL"
  ) {
    throw new RangeError("unverified_stress_scenario_cannot_be_verified");
  }
  seenIds.add(scenario.id);

  for (const value of [
    scenario.commissionBpsIncrease,
    scenario.spreadBpsIncrease,
    scenario.slippageBpsIncrease,
    scenario.gapReserveBps,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("invalid_stress_cost_increase");
    }
  }
  if (
    !Number.isSafeInteger(scenario.terminalFxShockBps) ||
    scenario.terminalFxShockBps <= -Number(BPS) ||
    !Number.isSafeInteger(Number(BPS) + scenario.terminalFxShockBps)
  ) {
    throw new RangeError("invalid_terminal_fx_shock");
  }
  if (
    reportingCurrency === input.instrument.quoteCurrency &&
    scenario.terminalFxShockBps !== 0
  ) {
    throw new RangeError("fx_shock_requires_currency_conversion");
  }
  if (scenario.maxParticipationBps !== undefined) {
    if (
      !Number.isSafeInteger(scenario.maxParticipationBps) ||
      scenario.maxParticipationBps < 1 ||
      scenario.maxParticipationBps > Number(BPS) ||
      input.costModels.some(
        ({ maxParticipationBps }) =>
          scenario.maxParticipationBps! > maxParticipationBps,
      )
    ) {
      throw new RangeError("stress_liquidity_capacity_must_not_increase");
    }
  }
}

function applyScenario(
  input: BacktestRunInput,
  scenario: StressScenario,
): BacktestRunInput {
  return {
    ...input,
    costModels: input.costModels.map((model) => ({
      ...model,
      version: `${model.version}+${scenario.version}`,
      sourceRecordId: scenario.sourceRecordId,
      dataClass: scenario.dataClass,
      verificationStatus: scenario.verificationStatus,
      commissionBps: model.commissionBps + scenario.commissionBpsIncrease,
      spreadBps: model.spreadBps + scenario.spreadBpsIncrease,
      slippageBps:
        model.slippageBps +
        scenario.slippageBpsIncrease +
        scenario.gapReserveBps,
      maxParticipationBps:
        scenario.maxParticipationBps ?? model.maxParticipationBps,
    })),
  };
}

function validateFxObservations(
  observations: readonly StressFxObservation[],
): Map<string, StressFxObservation> {
  const byDate = new Map<string, StressFxObservation>();
  for (const observation of observations) {
    const parsedDate = new Date(`${observation.date}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(observation.date) ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== observation.date ||
      !observation.sourceRecordId.trim() ||
      !Number.isSafeInteger(observation.marketAtMs) ||
      !Number.isSafeInteger(observation.availableAtMs) ||
      !Number.isSafeInteger(observation.validFromMs) ||
      !Number.isSafeInteger(observation.validUntilMs) ||
      observation.marketAtMs < 0 ||
      observation.availableAtMs < 0 ||
      observation.validFromMs < 0 ||
      observation.validUntilMs < 0 ||
      observation.validFromMs > observation.validUntilMs ||
      byDate.has(observation.date)
    ) {
      throw new RangeError("invalid_stress_fx_observation");
    }
    parseFxRate(
      observation.baseCurrency,
      observation.quoteCurrency,
      observation.rate,
    );
    byDate.set(observation.date, observation);
  }
  return byDate;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new RangeError("invalid_stress_input");
  return serialized;
}

function hashScenario(
  backtestHash: string,
  scenario: StressScenario,
  reportingCurrency: CurrencyCode,
  coverage: readonly StressWindowEvidence[],
  observations: readonly StressFxObservation[],
): string {
  const canonicalInput = {
    backtestHash,
    reportingCurrency,
    scenario: {
      ...scenario,
      maxParticipationBps: scenario.maxParticipationBps ?? null,
    },
    coverage: [...coverage].sort((left, right) => left.year - right.year),
    observations: [...observations].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
  };
  return createHash("sha256").update(stableJson(canonicalInput)).digest("hex");
}

function validatedObservation(
  date: string,
  closeAtMs: number,
  input: BacktestRunInput,
  reportingCurrency: CurrencyCode,
  byDate: ReadonlyMap<string, StressFxObservation>,
): StressFxObservation | null {
  const observation = byDate.get(date);
  if (!observation) return null;
  if (
    observation.baseCurrency !== input.instrument.quoteCurrency ||
    observation.quoteCurrency !== reportingCurrency ||
    observation.marketAtMs > closeAtMs ||
    observation.availableAtMs > closeAtMs ||
    observation.validFromMs > closeAtMs ||
    observation.validUntilMs < closeAtMs
  ) {
    return null;
  }
  return observation;
}

function toReportingMoney(
  value: string,
  date: string,
  closeAtMs: number,
  input: BacktestRunInput,
  reportingCurrency: CurrencyCode,
  byDate: ReadonlyMap<string, StressFxObservation>,
  roundingMode: RoundingMode,
): Money | null {
  const localMoney = moneyFromDecimal(
    value,
    input.instrument.quoteCurrency,
    roundingMode,
  );
  if (reportingCurrency === input.instrument.quoteCurrency) return localMoney;
  const observation = validatedObservation(
    date,
    closeAtMs,
    input,
    reportingCurrency,
    byDate,
  );
  if (!observation) return null;
  return convertMoney(
    localMoney,
    parseFxRate(
      observation.baseCurrency,
      observation.quoteCurrency,
      observation.rate,
    ),
    roundingMode,
  );
}

function windowMetrics(
  year: StressYear,
  input: BacktestRunInput,
  result: BacktestRunResult,
  fxByDate: ReadonlyMap<string, StressFxObservation>,
  closeAtByDate: ReadonlyMap<string, number>,
  reportingCurrency: CurrencyCode,
  terminalFxShockBps: number,
): StressWindowResult["metrics"] {
  const yearText = String(year);
  const yearSessions = result.sessions.filter(({ date }) =>
    date.startsWith(`${yearText}-`),
  );
  if (yearSessions.length === 0) return null;

  const firstDate = yearSessions[0].date;
  const lastDate = yearSessions.at(-1)!.date;
  const allSessionResults = result.sessions;
  const firstIndex = allSessionResults.findIndex(
    ({ date }) => date === firstDate,
  );
  const previous = firstIndex > 0 ? allSessionResults[firstIndex - 1] : null;
  const startingEquity = previous?.closeEquity ?? input.initialCash;
  const points = [
    {
      date: previous?.date ?? firstDate,
      equity: startingEquity,
    },
    ...yearSessions.map(({ date, closeEquity }) => ({
      date,
      equity: closeEquity,
    })),
  ];
  if (points.some(({ equity }) => equity === null)) return null;

  const reportingEquities: bigint[] = [];
  for (const point of points) {
    const closeAtMs = closeAtByDate.get(point.date);
    if (closeAtMs === undefined) return null;
    const converted = toReportingMoney(
      point.equity!,
      point.date,
      closeAtMs,
      input,
      reportingCurrency,
      fxByDate,
      "HALF_AWAY_FROM_ZERO",
    );
    if (!converted) return null;
    reportingEquities.push(converted.amountMinor);
  }

  const shockFactor = BPS + BigInt(terminalFxShockBps);
  reportingEquities[reportingEquities.length - 1] =
    (reportingEquities.at(-1)! * shockFactor) / BPS;
  const [initialEquityMinor, ...dailyEquities] = reportingEquities;
  const finalEquityMinor = dailyEquities.at(-1)!;
  const maxDrawdown = maximumDrawdownBps(reportingEquities);
  const yearOrders = result.orders.filter(
    ({ executionDate }) =>
      executionDate !== null &&
      executionDate >= firstDate &&
      executionDate <= lastDate,
  );
  const feesAtoms = yearOrders.reduce(
    (total, order) =>
      order.status === "FILLED" && order.fee
        ? total + decimalAtoms(order.fee)
        : total,
    BigInt(0),
  );
  const netReturnBps = basisPoints(
    finalEquityMinor - initialEquityMinor,
    initialEquityMinor,
  );
  if (maxDrawdown === null || netReturnBps === null) return null;

  return {
    reportingCurrency,
    feeCurrency: input.instrument.quoteCurrency,
    initialEquityMinor: initialEquityMinor.toString(),
    finalEquityMinor: finalEquityMinor.toString(),
    netReturnBps,
    maxDrawdownBps: maxDrawdown,
    fees: formatAtoms(feesAtoms),
    filledOrderCount: yearOrders.filter(({ status }) => status === "FILLED")
      .length,
    rejectedOrderCount: yearOrders.filter(({ status }) => status === "REJECTED")
      .length,
  };
}

function historicalWindow(
  year: StressYear,
  input: BacktestRunInput,
  result: BacktestRunResult,
  coverage: readonly StressWindowEvidence[],
  fxByDate: ReadonlyMap<string, StressFxObservation>,
  reportingCurrency: CurrencyCode,
  terminalFxShockBps: number,
): StressWindowResult {
  const evidence = coverage.find((item) => item.year === year) ?? null;
  const closeAtByDate = new Map(
    input.calendar.sessions.map(
      ({ date, closeAtMs }) => [date, closeAtMs] as const,
    ),
  );
  const yearSessions = result.sessions.filter(({ date }) =>
    date.startsWith(`${year}-`),
  );
  const reasonCodes = new Set<string>();
  if (!evidence) reasonCodes.add("HISTORICAL_COVERAGE_EVIDENCE_MISSING");
  if (yearSessions.length === 0) {
    reasonCodes.add("HISTORICAL_WINDOW_DATA_MISSING");
  }
  if (evidence) {
    if (!evidence.sourceRecordId.trim()) {
      reasonCodes.add("HISTORICAL_COVERAGE_SOURCE_MISSING");
    }
    if (evidence.coverage !== "COMPLETE") {
      reasonCodes.add("HISTORICAL_WINDOW_COVERAGE_INCOMPLETE");
    }
    if (
      evidence.dataClass !== "HISTORICAL" ||
      evidence.verificationStatus !== "VERIFIED"
    ) {
      reasonCodes.add("HISTORICAL_WINDOW_DATA_NOT_VERIFIED");
    }
    if (
      yearSessions.length > 0 &&
      (evidence.firstSessionDate !== yearSessions[0].date ||
        evidence.lastSessionDate !== yearSessions.at(-1)!.date)
    ) {
      reasonCodes.add("HISTORICAL_WINDOW_BOUNDARY_MISMATCH");
    }
  }
  if (result.resultClass !== "VERIFIED") {
    reasonCodes.add(
      result.resultClass === "DEMO_ONLY"
        ? "FIXTURE_NOT_HISTORICAL_EVIDENCE"
        : "BACKTEST_NOT_VERIFIED",
    );
  }
  if (
    input.source.dataClass !== "HISTORICAL" ||
    input.source.verificationStatus !== "VERIFIED"
  ) {
    reasonCodes.add("HISTORICAL_PRICE_SOURCE_NOT_VERIFIED");
  }
  if (
    yearSessions.some(
      ({ status, closeEquity }) => status !== "PRESENT" || closeEquity === null,
    )
  ) {
    reasonCodes.add("HISTORICAL_WINDOW_SESSION_GAP");
  }
  if (evidence?.parameterSelection === "UNKNOWN") {
    reasonCodes.add("PARAMETER_SELECTION_HISTORY_UNKNOWN");
  }
  if (input.instrument.quoteCurrency !== reportingCurrency) {
    const firstWindowIndex = result.sessions.findIndex(
      ({ date }) => date === yearSessions[0]?.date,
    );
    const previousDate =
      firstWindowIndex > 0
        ? result.sessions[firstWindowIndex - 1].date
        : yearSessions[0]?.date;
    const pointDates = new Set([
      ...yearSessions.map(({ date }) => date),
      ...(previousDate ? [previousDate] : []),
    ]);
    if (pointDates.size === 0) reasonCodes.add("FX_HISTORY_MISSING");
    for (const date of pointDates) {
      const closeAtMs = closeAtByDate.get(date);
      if (
        closeAtMs === undefined ||
        !validatedObservation(
          date,
          closeAtMs,
          input,
          reportingCurrency,
          fxByDate,
        )
      ) {
        reasonCodes.add("FX_HISTORY_INCOMPLETE_OR_NOT_POINT_IN_TIME");
      }
    }
    if (
      [...pointDates].some((date) => {
        const observation = fxByDate.get(date);
        return (
          !observation ||
          observation.dataClass !== "HISTORICAL" ||
          observation.verificationStatus !== "VERIFIED"
        );
      })
    ) {
      reasonCodes.add("FX_HISTORY_NOT_VERIFIED");
    }
  } else if (terminalFxShockBps !== 0) {
    reasonCodes.add("FX_SHOCK_WITHOUT_CURRENCY_CONVERSION");
  }

  const independentStress = evidence
    ? evidence.parameterSelection === "EXCLUDED"
    : null;
  const verified = reasonCodes.size === 0;
  const metrics = verified
    ? windowMetrics(
        year,
        input,
        result,
        fxByDate,
        closeAtByDate,
        reportingCurrency,
        terminalFxShockBps,
      )
    : null;
  if (verified && metrics === null) {
    reasonCodes.add("HISTORICAL_WINDOW_METRICS_UNAVAILABLE");
  }

  return {
    year,
    sourceRecordId: evidence?.sourceRecordId ?? null,
    coverage: evidence?.coverage ?? null,
    firstSessionDate: yearSessions[0]?.date ?? null,
    lastSessionDate: yearSessions.at(-1)?.date ?? null,
    status: metrics ? "VERIFIED" : "NOT_VERIFIED",
    reasonCodes: [...reasonCodes].sort(),
    parameterSelection: evidence?.parameterSelection ?? null,
    independentStress,
    metrics,
  };
}

export function runStressSensitivity(input: {
  backtest: BacktestRunInput;
  reportingCurrency: CurrencyCode;
  coverage: readonly StressWindowEvidence[];
  fxObservations: readonly StressFxObservation[];
  scenarios: readonly StressScenario[];
}): StressTestReport {
  if (
    new Set(input.coverage.map(({ year }) => year)).size !==
    input.coverage.length
  ) {
    throw new RangeError("duplicate_stress_window_evidence");
  }
  const fxByDate = validateFxObservations(input.fxObservations);
  const baseline = runBacktest(input.backtest);
  const baselineMetrics = metricsForRun(
    input.backtest.initialCash,
    input.backtest.instrument.quoteCurrency,
    baseline,
  );
  const baselineWindows = STRESS_YEARS.map((year) =>
    historicalWindow(
      year,
      input.backtest,
      baseline,
      input.coverage,
      fxByDate,
      input.reportingCurrency,
      0,
    ),
  );
  const seenIds = new Set<string>();
  const scenarios = input.scenarios.map((scenario) => {
    validateScenario(
      scenario,
      seenIds,
      input.backtest,
      input.reportingCurrency,
    );
    const scenarioInput = applyScenario(input.backtest, scenario);
    const backtest = runBacktest(scenarioInput);
    return {
      scenario,
      scenarioHashSha256: hashScenario(
        backtest.inputHashSha256,
        scenario,
        input.reportingCurrency,
        input.coverage,
        input.fxObservations,
      ),
      backtest,
      metrics: metricsForRun(
        scenarioInput.initialCash,
        scenarioInput.instrument.quoteCurrency,
        backtest,
      ),
      executionChanged: executionChanged(baseline, backtest),
      historicalWindows: STRESS_YEARS.map((year) =>
        historicalWindow(
          year,
          scenarioInput,
          backtest,
          input.coverage,
          fxByDate,
          input.reportingCurrency,
          scenario.terminalFxShockBps,
        ),
      ),
    };
  });

  return {
    baseline: {
      backtest: baseline,
      metrics: baselineMetrics,
      historicalWindows: baselineWindows,
    },
    scenarios,
  };
}
