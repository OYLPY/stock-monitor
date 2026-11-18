import { z } from "zod";

import { parseFixedDecimal } from "@/domain/primitives";
import type { BacktestSignal } from "@/features/backtest/engine";
import type {
  NormalizedOhlcvSeries,
  NormalizedOhlcvSession,
  VerificationStatus,
} from "@/features/quant/indicators";

const SCALE = BigInt(10) ** BigInt(8);
const BPS = BigInt(10_000);
const strategyIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const quantitySharesSchema = z.string().regex(/^[1-9]\d{0,17}$/);
const strategyInstrumentSchema = z.strictObject({
  instrumentId: z.string().trim().min(1).max(128),
  tradingUnit: quantitySharesSchema,
});
const sharedParameters = {
  strategyId: strategyIdSchema,
  quantityShares: quantitySharesSchema,
  stopLossBps: z.number().int().min(1).max(5_000),
  maxHoldingSessions: z.number().int().min(1).max(252),
};

export const initialStrategyConfigSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("POST_EARNINGS_DRIFT"),
    ...sharedParameters,
    minimumSurpriseBps: z.number().int().min(1).max(100_000),
    eventWindowSessions: z.number().int().min(1).max(20),
  }),
  z.strictObject({
    kind: z.literal("TREND_VOLUME_BREAKOUT"),
    ...sharedParameters,
    lookbackSessions: z.number().int().min(2).max(252),
    volumeMultipleBps: z.number().int().min(10_000).max(100_000),
  }),
  z.strictObject({
    kind: z.literal("MEAN_REVERSION"),
    ...sharedParameters,
    oversoldRsi: z.number().int().min(1).max(40),
    reboundRsi: z.number().int().min(50).max(99),
  }),
]);

export type InitialStrategyConfig = z.infer<typeof initialStrategyConfigSchema>;

const earningsEvidenceSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(128),
  instrumentId: z.string().trim().min(1).max(128),
  dataClass: z.enum([
    "REAL",
    "DELAYED",
    "HISTORICAL",
    "FIXTURE",
    "NOT_VERIFIED",
  ]),
  verificationStatus: z.enum(["VERIFIED", "NOT_VERIFIED"]),
  coverage: z.enum(["COMPLETE", "INCOMPLETE", "UNKNOWN"]),
  events: z.array(
    z.strictObject({
      eventId: z.string().trim().min(1).max(128),
      publishedAtMs: z.number().int().nonnegative().safe(),
      availableAtMs: z.number().int().nonnegative().safe(),
      surpriseBps: z.number().int().safe(),
      sourceRecordId: z.string().trim().min(1).max(128),
    }),
  ),
});

type EarningsEvidence = z.infer<typeof earningsEvidenceSchema>;
type EarningsEvent = EarningsEvidence["events"][number];
type StrategyWarningCode =
  | "SERIES_NOT_VERIFIED"
  | "EARNINGS_EVIDENCE_MISSING"
  | "EARNINGS_COVERAGE_INCOMPLETE"
  | "EARNINGS_INSTRUMENT_MISMATCH"
  | "SESSION_GAP"
  | "BAR_AVAILABILITY_UNKNOWN"
  | "INSUFFICIENT_HISTORY"
  | "LOOKBACK_DATA_GAP"
  | "RSI_UNAVAILABLE"
  | "INDICATOR_HISTORY_UNAVAILABLE"
  | "ADJUSTMENT_EVIDENCE_INCOMPLETE"
  | "POSITION_STOP_DATA_UNAVAILABLE"
  | "POSITION_OPEN_AT_END"
  | "EARNINGS_DRIFT_NOT_CONFIRMED"
  | "NEGATIVE_EARNINGS_NO_SHORT";

export type InitialStrategySignal = Readonly<
  BacktestSignal & {
    reasonCode: string;
    sourceRecordIds: readonly string[];
  }
>;

export type InitialStrategyRunResult = Readonly<{
  strategyVersion: "initial-strategies-v1";
  config: InitialStrategyConfig;
  resultClass: "VERIFIED" | "NOT_VERIFIED" | "DEMO_ONLY";
  verificationStatus: VerificationStatus;
  sourceIds: readonly string[];
  signals: readonly InitialStrategySignal[];
  warnings: readonly Readonly<{
    date: string | null;
    code: StrategyWarningCode;
  }>[];
}>;

export type InitialStrategyRunInput = Readonly<{
  config: unknown;
  instrument: Readonly<{ instrumentId: string; tradingUnit: string }>;
  series: NormalizedOhlcvSeries;
  earningsEvidence?: unknown | null;
}>;

type Position = Readonly<{ signalIndex: number }>;
type PendingEarningsEvent = Readonly<{
  event: EarningsEvent;
  firstAvailableIndex: number;
}>;
type Decision = Readonly<{
  reasonCode: string;
  sourceRecordIds: readonly string[];
}>;

function decimalScaled(value: string): bigint {
  const decimal = parseFixedDecimal(value);
  return decimal.mantissa * BigInt(10) ** BigInt(8 - decimal.scale);
}

function multiplyScaled(left: bigint, right: bigint): bigint {
  return (left * right + SCALE / BigInt(2)) / SCALE;
}

function usable(session: NormalizedOhlcvSession): boolean {
  return (
    session.status === "PRESENT" &&
    session.bar !== null &&
    session.signalAtMs !== null &&
    session.bar.availableAtMs === session.signalAtMs
  );
}

function adjustmentEvidenceIncompleteBySession(
  series: NormalizedOhlcvSeries,
): readonly boolean[] {
  if (
    series.adjustment.basis !== "RAW" ||
    series.adjustment.coverage !== "COMPLETE"
  ) {
    return series.sessions.map(() => true);
  }
  const firstDate = series.sessions[0]?.date;
  const lastDate = series.sessions.at(-1)?.date;
  const lateSplitDates = series.adjustment.actions.flatMap((action) => {
    if (
      action.kind !== "SPLIT" ||
      firstDate === undefined ||
      lastDate === undefined ||
      action.effectiveDate <= firstDate ||
      action.effectiveDate > lastDate
    ) {
      return [];
    }
    const effectiveSession = series.sessions.find(
      ({ date }) => date >= action.effectiveDate,
    );
    const effectiveBar = effectiveSession?.bar;
    return effectiveBar === undefined ||
      effectiveBar === null ||
      effectiveBar.availableAtMs === null ||
      action.knownAtMs > effectiveBar.availableAtMs
      ? [action.effectiveDate]
      : [];
  });
  return series.sessions.map(({ date }) =>
    lateSplitDates.some((effectiveDate) => effectiveDate <= date),
  );
}

function uniqueRecordIds(
  values: readonly (string | null | undefined)[],
): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function previousRecordIds(
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
): string[] {
  return uniqueRecordIds([
    sessions[index - 1]?.bar?.sourceRecordId,
    sessions[index]?.bar?.sourceRecordId,
  ]);
}

function barRecordIds(
  sessions: readonly NormalizedOhlcvSession[],
  start: number,
  end: number,
): string[] {
  return uniqueRecordIds(
    sessions.slice(start, end + 1).map(({ bar }) => bar?.sourceRecordId),
  );
}

function earningsEvidence(value: unknown): EarningsEvidence {
  const evidence = earningsEvidenceSchema.parse(value);
  const eventIds = new Set<string>();
  const sourceRecordIds = new Set<string>();
  for (const event of evidence.events) {
    if (event.availableAtMs < event.publishedAtMs) {
      throw new RangeError("earnings_available_before_publication");
    }
    if (eventIds.has(event.eventId)) {
      throw new RangeError("duplicate_earnings_event");
    }
    if (sourceRecordIds.has(event.sourceRecordId)) {
      throw new RangeError("duplicate_earnings_source_record");
    }
    eventIds.add(event.eventId);
    sourceRecordIds.add(event.sourceRecordId);
  }
  return evidence;
}

function usableEarnings(evidence: EarningsEvidence): boolean {
  return (
    evidence.coverage === "COMPLETE" &&
    evidence.verificationStatus === "VERIFIED" &&
    (evidence.dataClass === "REAL" ||
      evidence.dataClass === "DELAYED" ||
      evidence.dataClass === "HISTORICAL")
  );
}

function eventsByFirstAvailableSession(
  events: readonly EarningsEvent[],
  sessions: readonly NormalizedOhlcvSession[],
  adjustmentEvidenceIncomplete: readonly boolean[],
): Map<number, EarningsEvent[]> {
  const eventsByIndex = new Map<number, EarningsEvent[]>();
  const matchingEvents = [...events].sort(
    (left, right) =>
      left.availableAtMs - right.availableAtMs ||
      left.publishedAtMs - right.publishedAtMs ||
      left.eventId.localeCompare(right.eventId),
  );

  for (const event of matchingEvents) {
    const index = sessions.findIndex(
      (session, index) =>
        usable(session) &&
        !adjustmentEvidenceIncomplete[index] &&
        session.signalAtMs !== null &&
        session.signalAtMs > event.availableAtMs,
    );
    if (index < 0) continue;
    const sameSessionEvents = eventsByIndex.get(index) ?? [];
    sameSessionEvents.push(event);
    eventsByIndex.set(index, sameSessionEvents);
  }
  return eventsByIndex;
}

function barOnSessionBasis(
  previousSession: NormalizedOhlcvSession,
  currentSession: NormalizedOhlcvSession,
  series: NormalizedOhlcvSeries,
): Readonly<{
  high: bigint;
  close: bigint;
  volume: bigint;
  adjustmentRecordIds: readonly string[];
}> {
  const previousAdjustmentIds = new Set(
    previousSession.adjustmentRecordIdsAppliedToIndicators,
  );
  const currentAdjustmentIds = new Set(
    currentSession.adjustmentRecordIdsAppliedToIndicators,
  );
  const splits = series.adjustment.actions
    .filter(
      (action) =>
        action.kind === "SPLIT" &&
        currentAdjustmentIds.has(action.sourceRecordId) &&
        !previousAdjustmentIds.has(action.sourceRecordId),
    )
    .sort(
      (left, right) =>
        left.effectiveDate.localeCompare(right.effectiveDate) ||
        left.sourceRecordId.localeCompare(right.sourceRecordId),
    );
  let high = decimalScaled(previousSession.bar!.high);
  let close = decimalScaled(previousSession.bar!.close);
  let volume = decimalScaled(previousSession.bar!.volume);
  for (const split of splits) {
    high = multiplyScaled(high, decimalScaled(split.priceFactor));
    close = multiplyScaled(close, decimalScaled(split.priceFactor));
    volume = multiplyScaled(volume, decimalScaled(split.volumeFactor));
  }
  return {
    high,
    close,
    volume,
    adjustmentRecordIds: splits.map(({ sourceRecordId }) => sourceRecordId),
  };
}

function trendEntry(
  series: NormalizedOhlcvSeries,
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
  lookbackSessions: number,
  volumeMultipleBps: number,
): Decision | null {
  if (index < lookbackSessions) return null;
  const previous = sessions.slice(index - lookbackSessions, index);
  if (previous.some((session) => !usable(session))) return null;
  const current = sessions[index];
  const currentBar = current.bar!;
  const previousBars = previous.map((session) =>
    barOnSessionBasis(session, current, series),
  );
  const highestHigh = previousBars.reduce(
    (highest, bar) => (bar.high > highest ? bar.high : highest),
    BigInt(0),
  );
  const previousVolumeTotal = previousBars.reduce(
    (total, bar) => total + bar.volume,
    BigInt(0),
  );
  const volumePasses =
    decimalScaled(currentBar.volume) * BPS * BigInt(lookbackSessions) >=
    previousVolumeTotal * BigInt(volumeMultipleBps);

  if (decimalScaled(currentBar.close) <= highestHigh || !volumePasses) {
    return null;
  }
  return {
    reasonCode: "VOLUME_CONFIRMED_BREAKOUT",
    sourceRecordIds: uniqueRecordIds([
      ...barRecordIds(sessions, index - lookbackSessions, index),
      ...previousBars.flatMap(({ adjustmentRecordIds }) => adjustmentRecordIds),
    ]),
  };
}

function trendExit(
  series: NormalizedOhlcvSeries,
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
  lookbackSessions: number,
): Decision | null {
  if (index < lookbackSessions) return null;
  const previous = sessions.slice(index - lookbackSessions, index);
  if (previous.some((session) => !usable(session))) return null;
  const current = sessions[index];
  const previousBars = previous.map((session) =>
    barOnSessionBasis(session, current, series),
  );
  const previousCloseTotal = previousBars.reduce(
    (total, bar) => total + bar.close,
    BigInt(0),
  );
  if (
    decimalScaled(current.bar!.close) * BigInt(lookbackSessions) >=
    previousCloseTotal
  ) {
    return null;
  }
  return {
    reasonCode: "CLOSE_BELOW_PRIOR_AVERAGE",
    sourceRecordIds: uniqueRecordIds([
      ...barRecordIds(sessions, index - lookbackSessions, index),
      ...previousBars.flatMap(({ adjustmentRecordIds }) => adjustmentRecordIds),
    ]),
  };
}

function closeToCloseStop(
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
  stopLossBps: number,
): boolean | null {
  const session = sessions[index];
  if (index === 0 || !usable(sessions[index - 1])) return null;
  const dailyReturn = session.indicators.dailyReturn;
  if (dailyReturn.status !== "AVAILABLE" || dailyReturn.value === null) {
    return null;
  }
  return decimalScaled(dailyReturn.value) * BPS <= -BigInt(stopLossBps) * SCALE;
}

function meanReversionEntry(
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
  session: NormalizedOhlcvSession,
  oversoldRsi: number,
): Decision | null {
  const rsi = session.indicators.relativeStrengthIndex14;
  if (rsi.status !== "AVAILABLE" || rsi.value === null) return null;
  if (decimalScaled(rsi.value) > BigInt(oversoldRsi) * SCALE) return null;
  return {
    reasonCode: "RSI_OVERSOLD",
    sourceRecordIds: barRecordIdsForRsi(sessions, index),
  };
}

function barRecordIdsForRsi(
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
): string[] {
  let start = index;
  while (start > 0 && sessions[start - 1].status !== "GAP") start -= 1;
  return barRecordIds(sessions, start, index);
}

function meanReversionExit(
  sessions: readonly NormalizedOhlcvSession[],
  index: number,
  session: NormalizedOhlcvSession,
  reboundRsi: number,
): Decision | null {
  const rsi = session.indicators.relativeStrengthIndex14;
  if (rsi.status !== "AVAILABLE" || rsi.value === null) return null;
  if (decimalScaled(rsi.value) < BigInt(reboundRsi) * SCALE) return null;
  return {
    reasonCode: "RSI_REBOUND",
    sourceRecordIds: barRecordIdsForRsi(sessions, index),
  };
}

export function generateInitialStrategySignals(
  input: InitialStrategyRunInput,
): InitialStrategyRunResult {
  const config = initialStrategyConfigSchema.parse(input.config);
  const instrument = strategyInstrumentSchema.parse(input.instrument);
  const instrumentId = instrument.instrumentId;
  const tradingUnitText = instrument.tradingUnit;
  if (
    !instrumentId ||
    !/^[1-9]\d*$/.test(tradingUnitText) ||
    BigInt(config.quantityShares) % BigInt(tradingUnitText) !== BigInt(0)
  ) {
    throw new RangeError("invalid_strategy_instrument_or_quantity");
  }

  const earnings =
    config.kind === "POST_EARNINGS_DRIFT" && input.earningsEvidence != null
      ? earningsEvidence(input.earningsEvidence)
      : null;
  const warnings: { date: string | null; code: StrategyWarningCode }[] = [];
  let verified = input.series.verificationStatus === "VERIFIED";
  if (!verified) warnings.push({ date: null, code: "SERIES_NOT_VERIFIED" });
  const sessions = input.series.sessions;
  const adjustmentEvidenceIncomplete = adjustmentEvidenceIncompleteBySession(
    input.series,
  );

  let eventsByIndex = new Map<number, EarningsEvent[]>();
  if (config.kind === "POST_EARNINGS_DRIFT") {
    if (!earnings) {
      verified = false;
      warnings.push({ date: null, code: "EARNINGS_EVIDENCE_MISSING" });
    } else if (earnings.instrumentId !== instrumentId) {
      verified = false;
      warnings.push({ date: null, code: "EARNINGS_INSTRUMENT_MISMATCH" });
    } else if (!usableEarnings(earnings)) {
      verified = false;
      warnings.push({ date: null, code: "EARNINGS_COVERAGE_INCOMPLETE" });
    } else {
      eventsByIndex = eventsByFirstAvailableSession(
        earnings.events,
        sessions,
        adjustmentEvidenceIncomplete,
      );
    }
  }

  const signals: InitialStrategySignal[] = [];
  let pendingEarnings: PendingEarningsEvent[] = [];
  let position: Position | null = null;
  let indicatorHistoryAvailable = true;

  for (const [index, session] of sessions.entries()) {
    if (session.status === "GAP" || session.bar === null) {
      verified = false;
      indicatorHistoryAvailable = session.status === "GAP";
      warnings.push({ date: session.date, code: "SESSION_GAP" });
      continue;
    }
    if (!usable(session)) {
      verified = false;
      indicatorHistoryAvailable = false;
      warnings.push({ date: session.date, code: "BAR_AVAILABILITY_UNKNOWN" });
      continue;
    }
    if (adjustmentEvidenceIncomplete[index]) {
      verified = false;
      warnings.push({
        date: session.date,
        code: "ADJUSTMENT_EVIDENCE_INCOMPLETE",
      });
      if (position) {
        signals.push({
          id: `${config.strategyId}:${session.date}:sell`,
          sourceDate: session.date,
          signalAtMs: session.signalAtMs!,
          side: "SELL",
          quantityShares: config.quantityShares,
          reasonCode: "ADJUSTMENT_EVIDENCE_INCOMPLETE",
          sourceRecordIds: uniqueRecordIds([
            session.bar.sourceRecordId,
            input.series.adjustment.sourceRecordId,
            ...input.series.adjustment.actions
              .filter((action) => action.effectiveDate <= session.date)
              .map(({ sourceRecordId }) => sourceRecordId),
          ]),
        });
        position = null;
      }
      continue;
    }

    let exit: Decision | null = null;
    if (position) {
      const stopTriggered = closeToCloseStop(
        sessions,
        index,
        config.stopLossBps,
      );
      if (stopTriggered === null) {
        verified = false;
        warnings.push({
          date: session.date,
          code: "POSITION_STOP_DATA_UNAVAILABLE",
        });
        exit = {
          reasonCode: "STOP_DATA_UNAVAILABLE",
          sourceRecordIds: previousRecordIds(sessions, index),
        };
      } else if (stopTriggered) {
        exit = {
          reasonCode: "CLOSE_TO_CLOSE_STOP",
          sourceRecordIds: previousRecordIds(sessions, index),
        };
      }

      if (!exit && config.kind === "POST_EARNINGS_DRIFT" && earnings) {
        const negativeEvent = (eventsByIndex.get(index) ?? [])
          .filter((event) => event.surpriseBps <= -config.minimumSurpriseBps)
          .at(-1);
        if (negativeEvent) {
          exit = {
            reasonCode: "NEGATIVE_EARNINGS_EXIT",
            sourceRecordIds: [
              negativeEvent.sourceRecordId,
              session.bar.sourceRecordId,
            ],
          };
        }
      } else if (!exit && config.kind === "TREND_VOLUME_BREAKOUT") {
        exit = trendExit(
          input.series,
          sessions,
          index,
          config.lookbackSessions,
        );
        if (!exit && index >= config.lookbackSessions) {
          const previous = sessions.slice(
            index - config.lookbackSessions,
            index,
          );
          if (previous.some((prior) => !usable(prior))) {
            warnings.push({ date: session.date, code: "LOOKBACK_DATA_GAP" });
          }
        }
      } else if (!exit && config.kind === "MEAN_REVERSION") {
        if (indicatorHistoryAvailable) {
          exit = meanReversionExit(sessions, index, session, config.reboundRsi);
        } else {
          warnings.push({
            date: session.date,
            code: "INDICATOR_HISTORY_UNAVAILABLE",
          });
        }
        if (
          !exit &&
          indicatorHistoryAvailable &&
          session.indicators.relativeStrengthIndex14.status !== "AVAILABLE"
        ) {
          warnings.push({ date: session.date, code: "RSI_UNAVAILABLE" });
        }
      }

      if (!exit && index - position.signalIndex >= config.maxHoldingSessions) {
        exit = {
          reasonCode: "MAX_HOLDING_SESSIONS",
          sourceRecordIds: [session.bar.sourceRecordId],
        };
      }

      if (exit) {
        signals.push({
          id: `${config.strategyId}:${session.date}:sell`,
          sourceDate: session.date,
          signalAtMs: session.signalAtMs!,
          side: "SELL",
          quantityShares: config.quantityShares,
          ...exit,
        });
        position = null;
        continue;
      }
      continue;
    }

    let entry: Decision | null = null;
    if (config.kind === "POST_EARNINGS_DRIFT" && earnings) {
      for (const event of eventsByIndex.get(index) ?? []) {
        if (event.surpriseBps >= config.minimumSurpriseBps) {
          pendingEarnings.push({ event, firstAvailableIndex: index });
        } else if (event.surpriseBps <= -config.minimumSurpriseBps) {
          warnings.push({
            date: session.date,
            code: "NEGATIVE_EARNINGS_NO_SHORT",
          });
        }
      }
      pendingEarnings = pendingEarnings.filter((pending) => {
        if (index - pending.firstAvailableIndex < config.eventWindowSessions) {
          return true;
        }
        warnings.push({
          date: session.date,
          code: "EARNINGS_DRIFT_NOT_CONFIRMED",
        });
        return false;
      });
      const previousSession = sessions[index - 1];
      const event = pendingEarnings.at(-1)?.event;
      if (
        event &&
        previousSession &&
        usable(previousSession) &&
        decimalScaled(session.bar.close) >
          decimalScaled(previousSession.bar!.close)
      ) {
        entry = {
          reasonCode: "POSITIVE_EARNINGS_DRIFT",
          sourceRecordIds: [
            event.sourceRecordId,
            previousSession.bar!.sourceRecordId,
            session.bar.sourceRecordId,
          ],
        };
        pendingEarnings = [];
      }
    } else if (config.kind === "TREND_VOLUME_BREAKOUT") {
      if (index < config.lookbackSessions) {
        warnings.push({ date: session.date, code: "INSUFFICIENT_HISTORY" });
      } else {
        const previous = sessions.slice(index - config.lookbackSessions, index);
        if (previous.some((prior) => !usable(prior))) {
          warnings.push({ date: session.date, code: "LOOKBACK_DATA_GAP" });
        } else {
          entry = trendEntry(
            input.series,
            sessions,
            index,
            config.lookbackSessions,
            config.volumeMultipleBps,
          );
        }
      }
    } else if (config.kind === "MEAN_REVERSION") {
      if (indicatorHistoryAvailable) {
        entry = meanReversionEntry(
          sessions,
          index,
          session,
          config.oversoldRsi,
        );
      } else {
        warnings.push({
          date: session.date,
          code: "INDICATOR_HISTORY_UNAVAILABLE",
        });
      }
      if (
        !entry &&
        indicatorHistoryAvailable &&
        session.indicators.relativeStrengthIndex14.status !== "AVAILABLE"
      ) {
        warnings.push({ date: session.date, code: "RSI_UNAVAILABLE" });
      }
    }

    if (entry) {
      signals.push({
        id: `${config.strategyId}:${session.date}:buy`,
        sourceDate: session.date,
        signalAtMs: session.signalAtMs!,
        side: "BUY",
        quantityShares: config.quantityShares,
        ...entry,
      });
      position = { signalIndex: index };
    }
  }

  if (position) {
    warnings.push({
      date: sessions.at(-1)?.date ?? null,
      code: "POSITION_OPEN_AT_END",
    });
  }

  const verificationStatus: VerificationStatus = verified
    ? "VERIFIED"
    : "NOT_VERIFIED";
  const containsFixture =
    input.series.source.dataClass === "FIXTURE" ||
    input.series.adjustment.dataClass === "FIXTURE" ||
    earnings?.dataClass === "FIXTURE";

  return {
    strategyVersion: "initial-strategies-v1",
    config,
    resultClass: containsFixture ? "DEMO_ONLY" : verificationStatus,
    verificationStatus,
    sourceIds: uniqueRecordIds([
      input.series.source.sourceId,
      input.series.expectedSessions.sourceId,
      input.series.adjustment.sourceId,
      earnings?.sourceId,
    ]),
    signals,
    warnings,
  };
}
