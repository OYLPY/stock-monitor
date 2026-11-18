import { createHash } from "node:crypto";

import { z } from "zod";

import type { BacktestRunResult } from "@/features/backtest/engine";

const MINIMUM_CLOSED_TRADES = 30;
const BOOTSTRAP_REPLICATES = 1_000;
// shortcut: cap sessions, folds, and recorded attempts per fold, raise after full-history performance profiling.
const MAX_SESSIONS = 100_000;
const MAX_FOLDS = 500;
const MAX_ATTEMPTS_PER_FOLD = 1_000;

const positiveCount = z.number().int().min(1).max(MAX_SESSIONS);
const walkForwardPlanSchema = z.strictObject({
  trainingWindow: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("EXPANDING"),
      initialSessions: positiveCount,
    }),
    z.strictObject({ kind: z.literal("ROLLING"), sessions: positiveCount }),
  ]),
  testSessions: positiveCount,
  stepSessions: positiveCount,
  bootstrapBlockLength: positiveCount,
  embargoSessions: z.number().int().min(0).max(MAX_SESSIONS).default(0),
});

export type WalkForwardPlan = z.input<typeof walkForwardPlanSchema>;

export type ClosedTrade = Readonly<{
  id: string;
  entryDate: string;
  exitDate: string;
  netReturnBps: number;
}>;

export type ParameterAttempt<TParameters extends Record<string, unknown>> =
  Readonly<{
    id: string;
    parameters: TParameters;
    trainingScoreBps: number | null;
    selected: boolean;
  }>;

export type ParameterSelection<TParameters extends Record<string, unknown>> =
  Readonly<{
    parameters: TParameters;
    attempts: readonly ParameterAttempt<TParameters>[];
  }>;

export type WalkForwardSummary = Readonly<{
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number | null;
  meanNetReturnBps: number | null;
  returnDistributionBps: Readonly<{
    p05: number;
    p50: number;
    p95: number;
  }> | null;
  bootstrapMeanNetReturnBps95Ci: Readonly<{
    method: "CIRCULAR_BLOCK";
    blockLength: number;
    replicates: number;
    lower: number;
    upper: number;
  }> | null;
}>;

type ValidationSession = Readonly<{ date: string }>;
type ResultClass = BacktestRunResult["resultClass"];

type FoldEvaluation = Readonly<{
  backtestEngineVersion: BacktestRunResult["engineVersion"];
  resultClass: ResultClass;
  closedTrades: readonly ClosedTrade[];
  openPositionCount: number;
}>;

type ValidationReason =
  | "BACKTEST_NOT_VERIFIED"
  | "FIXTURE_DATA"
  | "INSUFFICIENT_OOS_TRADES"
  | "INSUFFICIENT_RESAMPLING_BLOCKS"
  | "OPEN_POSITIONS_OMITTED"
  | "INSUFFICIENT_SESSIONS";

export type WalkForwardFoldReport<TParameters extends Record<string, unknown>> =
  Readonly<{
    index: number;
    trainingStartDate: string;
    trainingEndDate: string;
    trainingSessions: number;
    trainingDataHashSha256: string;
    embargoDates: readonly string[];
    testStartDate: string;
    testEndDate: string;
    testSessions: number;
    testDataHashSha256: string;
    parameters: TParameters;
    parametersHashSha256: string;
    backtestEngineVersion: BacktestRunResult["engineVersion"];
    attempts: readonly Readonly<{
      id: string;
      parameters: TParameters;
      parametersHashSha256: string;
      trainingScoreBps: number | null;
      selected: boolean;
    }>[];
    resultClass: ResultClass;
    reasons: readonly ValidationReason[];
    closedTrades: readonly ClosedTrade[];
    openPositionCount: number;
    summary: WalkForwardSummary;
  }>;

export type WalkForwardValidationResult<
  TParameters extends Record<string, unknown>,
> = Readonly<{
  engineVersion: "walk-forward-validation-v1";
  strategyVersion: string;
  selectionRuleVersion: string;
  inputHashSha256: string;
  resultClass: ResultClass;
  reasons: readonly ValidationReason[];
  folds: readonly WalkForwardFoldReport<TParameters>[];
  summary: WalkForwardSummary;
}>;

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RangeError("invalid_validation_input");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new RangeError("invalid_validation_input");
    ancestors.add(value);
    const serialized = `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new RangeError("invalid_validation_input");
  }
  if (ancestors.has(value)) throw new RangeError("invalid_validation_input");
  ancestors.add(value);
  const serialized = `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJson(entry, ancestors)}`,
    )
    .join(",")}}`;
  ancestors.delete(value);
  return serialized;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value;
}

function percentile(
  sorted: readonly number[],
  fraction: number,
): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined) return null;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function bootstrapMeanInterval(
  trades: readonly ClosedTrade[],
  blockLength: number,
): {
  method: "CIRCULAR_BLOCK";
  blockLength: number;
  replicates: number;
  lower: number;
  upper: number;
} | null {
  // shortcut: blocks preserve local order only, upgrade to regime-aware resampling after validation.
  if (trades.length < MINIMUM_CLOSED_TRADES || blockLength >= trades.length)
    return null;
  const values = trades.map(({ netReturnBps }) => netReturnBps);
  let state = Number.parseInt(hash(values).slice(0, 8), 16) || 0x6d2b79f5;
  const nextRandom = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const means: number[] = [];
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    let sum = 0;
    for (let sample = 0; sample < values.length;) {
      const start = Math.floor(nextRandom() * values.length);
      for (
        let offset = 0;
        offset < blockLength && sample < values.length;
        offset += 1, sample += 1
      ) {
        const value = values[(start + offset) % values.length];
        if (value === undefined)
          throw new RangeError("invalid_validation_input");
        sum += value;
      }
    }
    means.push(sum / values.length);
  }
  means.sort((left, right) => left - right);
  const lower = percentile(means, 0.025);
  const upper = percentile(means, 0.975);
  return lower === null || upper === null
    ? null
    : {
        method: "CIRCULAR_BLOCK",
        blockLength,
        replicates: BOOTSTRAP_REPLICATES,
        lower,
        upper,
      };
}

function summarize(
  trades: readonly ClosedTrade[],
  bootstrapBlockLength: number | null,
): WalkForwardSummary {
  if (trades.length === 0) {
    return {
      tradeCount: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: null,
      meanNetReturnBps: null,
      returnDistributionBps: null,
      bootstrapMeanNetReturnBps95Ci: null,
    };
  }
  const returns = trades
    .map(({ netReturnBps }) => netReturnBps)
    .sort((a, b) => a - b);
  const winningTrades = returns.filter((value) => value > 0).length;
  const losingTrades = returns.filter((value) => value < 0).length;
  const p05 = percentile(returns, 0.05);
  const p50 = percentile(returns, 0.5);
  const p95 = percentile(returns, 0.95);
  if (p05 === null || p50 === null || p95 === null) {
    throw new RangeError("invalid_validation_input");
  }
  return {
    tradeCount: trades.length,
    winningTrades,
    losingTrades,
    breakevenTrades: returns.length - winningTrades - losingTrades,
    winRate: winningTrades / returns.length,
    meanNetReturnBps:
      returns.reduce((sum, value) => sum + value, 0) / returns.length,
    returnDistributionBps: { p05, p50, p95 },
    bootstrapMeanNetReturnBps95Ci:
      bootstrapBlockLength !== null
        ? bootstrapMeanInterval(trades, bootstrapBlockLength)
        : null,
  };
}

function validateSessions<TSession extends ValidationSession>(
  sessions: readonly TSession[],
): void {
  if (sessions.length > MAX_SESSIONS)
    throw new RangeError("too_many_validation_sessions");
  let previousDate: string | null = null;
  for (const session of sessions) {
    if (
      !isValidDate(session.date) ||
      (previousDate !== null && session.date <= previousDate)
    ) {
      throw new RangeError("invalid_validation_session_order");
    }
    previousDate = session.date;
  }
}

// shortcut: callback isolation is contractual, use a separate process before accepting untrusted strategies.
export function runWalkForwardValidation<
  TSession extends ValidationSession,
  TParameters extends Record<string, unknown>,
>(
  input: Readonly<{
    sessions: readonly TSession[];
    plan: WalkForwardPlan;
    strategyVersion: string;
    selectionRuleVersion: string;
    selectParameters: (
      trainingSessions: readonly TSession[],
    ) => ParameterSelection<TParameters>;
    evaluate: (
      window: Readonly<{
        historySessions: readonly TSession[];
        outOfSampleSessions: readonly TSession[];
        parameters: TParameters;
      }>,
    ) => FoldEvaluation;
  }>,
): WalkForwardValidationResult<TParameters> {
  const plan = walkForwardPlanSchema.parse(input.plan);
  if (plan.stepSessions < plan.testSessions) {
    throw new RangeError("overlapping_out_of_sample_windows");
  }
  if (!input.strategyVersion.trim() || !input.selectionRuleVersion.trim()) {
    throw new RangeError("missing_validation_version");
  }
  validateSessions(input.sessions);
  const sessionsHashSha256 = hash(input.sessions);
  const sessions = freezeDeep(structuredClone(input.sessions));

  const minimumTrainingSessions =
    plan.trainingWindow.kind === "EXPANDING"
      ? plan.trainingWindow.initialSessions
      : plan.trainingWindow.sessions;
  const folds: WalkForwardFoldReport<TParameters>[] = [];
  let testStart = minimumTrainingSessions + plan.embargoSessions;
  const remainingSessions = sessions.length - testStart - plan.testSessions;
  const plannedFoldCount =
    remainingSessions < 0
      ? 0
      : Math.floor(remainingSessions / plan.stepSessions) + 1;
  if (plannedFoldCount > MAX_FOLDS) {
    throw new RangeError("too_many_walk_forward_folds");
  }
  while (testStart + plan.testSessions <= sessions.length) {
    const trainingEnd = testStart - plan.embargoSessions;
    const trainingStart =
      plan.trainingWindow.kind === "ROLLING"
        ? trainingEnd - plan.trainingWindow.sessions
        : 0;
    if (trainingStart < 0) throw new RangeError("invalid_walk_forward_plan");

    const trainingSessions = Object.freeze(
      sessions.slice(trainingStart, trainingEnd),
    );
    const embargoSessions = sessions.slice(trainingEnd, testStart);
    const outOfSampleSessions = Object.freeze(
      sessions.slice(testStart, testStart + plan.testSessions),
    );
    const selection = input.selectParameters(trainingSessions);
    if (
      !selection ||
      !Array.isArray(selection.attempts) ||
      selection.attempts.length === 0 ||
      selection.attempts.length > MAX_ATTEMPTS_PER_FOLD
    ) {
      throw new RangeError("invalid_parameter_attempts");
    }
    canonicalJson(selection.parameters);
    const parameters = freezeDeep(structuredClone(selection.parameters));
    const parametersHashSha256 = hash(parameters);
    const attemptIds = new Set<string>();
    const attempts = selection.attempts.map((attempt) => {
      if (
        typeof attempt.id !== "string" ||
        !attempt.id.trim() ||
        typeof attempt.selected !== "boolean" ||
        attemptIds.has(attempt.id) ||
        (attempt.trainingScoreBps !== null &&
          !Number.isFinite(attempt.trainingScoreBps))
      ) {
        throw new RangeError("invalid_parameter_attempts");
      }
      attemptIds.add(attempt.id);
      canonicalJson(attempt.parameters);
      const attemptParameters = freezeDeep(structuredClone(attempt.parameters));
      return {
        id: attempt.id,
        parameters: attemptParameters,
        parametersHashSha256: hash(attemptParameters),
        trainingScoreBps: attempt.trainingScoreBps,
        selected: attempt.selected,
      };
    });
    const selectedAttempts = attempts.filter(({ selected }) => selected);
    if (
      selectedAttempts.length !== 1 ||
      selectedAttempts[0]?.parametersHashSha256 !== parametersHashSha256
    ) {
      throw new RangeError("selected_parameters_must_match_one_attempt");
    }

    const evaluation = input.evaluate({
      historySessions: Object.freeze(sessions.slice(0, testStart)),
      outOfSampleSessions,
      parameters,
    });
    if (
      !evaluation ||
      typeof evaluation.backtestEngineVersion !== "string" ||
      !evaluation.backtestEngineVersion.trim() ||
      !["VERIFIED", "NOT_VERIFIED", "DEMO_ONLY"].includes(
        evaluation.resultClass,
      ) ||
      !Number.isSafeInteger(evaluation.openPositionCount) ||
      evaluation.openPositionCount < 0 ||
      !Array.isArray(evaluation.closedTrades) ||
      evaluation.closedTrades.length > MAX_SESSIONS
    ) {
      throw new RangeError("invalid_walk_forward_evaluation");
    }
    const testDates = new Set(outOfSampleSessions.map(({ date }) => date));
    const tradeIds = new Set<string>();
    let previousExitDate: string | null = null;
    for (const trade of evaluation.closedTrades) {
      if (
        !trade.id.trim() ||
        tradeIds.has(trade.id) ||
        !isValidDate(trade.entryDate) ||
        !isValidDate(trade.exitDate) ||
        trade.entryDate >= trade.exitDate ||
        (previousExitDate !== null && trade.entryDate <= previousExitDate) ||
        !testDates.has(trade.entryDate) ||
        !testDates.has(trade.exitDate) ||
        !Number.isFinite(trade.netReturnBps)
      ) {
        throw new RangeError("invalid_walk_forward_trade");
      }
      tradeIds.add(trade.id);
      previousExitDate = trade.exitDate;
    }

    const reasons: ValidationReason[] = [];
    if (evaluation.resultClass === "DEMO_ONLY") reasons.push("FIXTURE_DATA");
    if (evaluation.resultClass === "NOT_VERIFIED")
      reasons.push("BACKTEST_NOT_VERIFIED");
    if (evaluation.closedTrades.length < MINIMUM_CLOSED_TRADES) {
      reasons.push("INSUFFICIENT_OOS_TRADES");
    }
    if (
      evaluation.closedTrades.length >= MINIMUM_CLOSED_TRADES &&
      plan.bootstrapBlockLength >= evaluation.closedTrades.length
    ) {
      reasons.push("INSUFFICIENT_RESAMPLING_BLOCKS");
    }
    if (evaluation.openPositionCount > 0)
      reasons.push("OPEN_POSITIONS_OMITTED");
    const resultClass: ResultClass =
      evaluation.resultClass === "DEMO_ONLY"
        ? "DEMO_ONLY"
        : reasons.length === 0
          ? "VERIFIED"
          : "NOT_VERIFIED";

    folds.push({
      index: folds.length + 1,
      trainingStartDate: trainingSessions[0]?.date ?? "",
      trainingEndDate: trainingSessions.at(-1)?.date ?? "",
      trainingSessions: trainingSessions.length,
      trainingDataHashSha256: hash(trainingSessions),
      embargoDates: embargoSessions.map(({ date }) => date),
      testStartDate: outOfSampleSessions[0]?.date ?? "",
      testEndDate: outOfSampleSessions.at(-1)?.date ?? "",
      testSessions: outOfSampleSessions.length,
      testDataHashSha256: hash(outOfSampleSessions),
      parameters,
      parametersHashSha256,
      backtestEngineVersion: evaluation.backtestEngineVersion,
      attempts,
      resultClass,
      reasons,
      closedTrades: evaluation.closedTrades,
      openPositionCount: evaluation.openPositionCount,
      summary: summarize(evaluation.closedTrades, plan.bootstrapBlockLength),
    });
    testStart += plan.stepSessions;
  }

  const allTrades = folds.flatMap(({ closedTrades }) => closedTrades);
  const reasons =
    folds.length === 0
      ? ["INSUFFICIENT_SESSIONS" as const]
      : [...new Set(folds.flatMap(({ reasons: foldReasons }) => foldReasons))];
  const resultClass: ResultClass = folds.some(
    ({ resultClass: foldClass }) => foldClass === "DEMO_ONLY",
  )
    ? "DEMO_ONLY"
    : folds.length > 0 &&
        folds.every(({ resultClass: foldClass }) => foldClass === "VERIFIED")
      ? "VERIFIED"
      : "NOT_VERIFIED";

  return {
    engineVersion: "walk-forward-validation-v1",
    strategyVersion: input.strategyVersion,
    selectionRuleVersion: input.selectionRuleVersion,
    inputHashSha256: hash({
      plan,
      sessionsHashSha256,
      strategyVersion: input.strategyVersion,
      selectionRuleVersion: input.selectionRuleVersion,
      folds: folds.map(
        ({ backtestEngineVersion, parametersHashSha256, attempts }) => ({
          backtestEngineVersion,
          parametersHashSha256,
          attempts: attempts.map(
            ({
              id,
              parametersHashSha256: attemptHash,
              trainingScoreBps,
              selected,
            }) => ({
              id,
              parametersHashSha256: attemptHash,
              trainingScoreBps,
              selected,
            }),
          ),
        }),
      ),
    }),
    resultClass,
    reasons,
    folds,
    summary: summarize(allTrades, null),
  };
}
