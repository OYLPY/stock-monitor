import { marketDateAt, parseFixedDecimal } from "@/domain/primitives";
import type { MarketCode } from "@/domain/primitives";

const OUTPUT_SCALE = 8;
const SCALE = BigInt(10) ** BigInt(OUTPUT_SCALE);
const LOG_RATIO_SCALE = BigInt(10) ** BigInt(16);
const ATR_PERIOD = 14;
const RSI_PERIOD = 14;

export type OhlcvDataClass =
  "REAL" | "DELAYED" | "HISTORICAL" | "FIXTURE" | "NOT_VERIFIED";
export type VerificationStatus = "VERIFIED" | "NOT_VERIFIED";
export type OhlcvBarInput = Readonly<{
  date: string;
  availableAtMs: number | null;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  sourceRecordId: string;
}>;
export type CorporateActionAdjustment = Readonly<{
  effectiveDate: string;
  knownAtMs: number;
  kind: "SPLIT" | "CASH_DIVIDEND";
  priceFactor: string;
  volumeFactor: string;
  sourceRecordId: string;
}>;
export type OhlcvInput = Readonly<{
  market: MarketCode;
  source: Readonly<{
    sourceId: string;
    dataClass: OhlcvDataClass;
    verificationStatus: VerificationStatus;
  }>;
  expectedSessions: Readonly<{
    sessions: readonly Readonly<{ date: string; closeAtMs: number }>[];
    sourceId: string;
    calendarVersion: string;
    verificationStatus: VerificationStatus;
  }>;
  adjustment: Readonly<{
    basis: "RAW" | "SPLIT_ADJUSTED" | "TOTAL_RETURN_ADJUSTED" | "UNKNOWN";
    coverage: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
    sourceId: string;
    dataClass: OhlcvDataClass;
    verificationStatus: VerificationStatus;
    sourceRecordId: string;
    actions: readonly CorporateActionAdjustment[];
  }>;
  indicatorWindows: Readonly<{
    movingAverage: number;
    returns: number;
  }>;
  bars: readonly OhlcvBarInput[];
}>;

type MetricStatus = "AVAILABLE" | "INSUFFICIENT_HISTORY" | "GAP";
type MetricValue<T> = Readonly<{ value: T | null; status: MetricStatus }>;
type ParsedBar = Omit<OhlcvBarInput, "volume"> & {
  openScaled: bigint;
  highScaled: bigint;
  lowScaled: bigint;
  closeScaled: bigint;
  volumeScaled: bigint;
};
type ParsedAction = CorporateActionAdjustment & {
  priceFactorScaled: bigint;
  volumeFactorScaled: bigint;
};
type Indicators = Readonly<{
  simpleMovingAverage: MetricValue<string>;
  averageTrueRange14: MetricValue<string>;
  dailyReturn: MetricValue<string>;
  dailyLogReturn: MetricValue<string>;
  realizedVolatility: MetricValue<string>;
  logReturnQuantiles: MetricValue<
    Readonly<{ p05: string; p50: string; p95: string }>
  >;
  relativeStrengthIndex14: MetricValue<string>;
}>;

type NormalizedBar = Readonly<{
  date: string;
  availableAtMs: number | null;
  sourceRecordId: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}>;

export type NormalizedOhlcvSession = Readonly<{
  date: string;
  sessionIndex: number;
  signalAtMs: number | null;
  status: "PRESENT" | "GAP";
  verificationStatus: VerificationStatus;
  adjustmentRecordIdsAppliedToIndicators: readonly string[];
  bar: NormalizedBar | null;
  indicators: Indicators;
}>;
export type NormalizedOhlcvSeries = Readonly<{
  market: MarketCode;
  source: OhlcvInput["source"];
  expectedSessions: OhlcvInput["expectedSessions"];
  adjustment: OhlcvInput["adjustment"];
  indicatorWindows: OhlcvInput["indicatorWindows"];
  indicatorPriceBasis: "SPLIT_ADJUSTED_AS_OF_SESSION";
  adjustmentStatus: VerificationStatus;
  verificationStatus: VerificationStatus;
  decimalScale: typeof OUTPUT_SCALE;
  sessions: readonly NormalizedOhlcvSession[];
}>;

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new RangeError("invalid_denominator");
  const sign = numerator < BigInt(0) ? -BigInt(1) : BigInt(1);
  const absolute = numerator < BigInt(0) ? -numerator : numerator;
  return sign * ((absolute + denominator / BigInt(2)) / denominator);
}

function formatScaled(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(OUTPUT_SCALE, "0");
  return `${sign}${whole}.${fraction}`;
}

function parseScaledDecimal(value: string, allowZero: boolean): bigint {
  const decimal = parseFixedDecimal(value);
  if (
    decimal.mantissa < BigInt(0) ||
    (!allowZero && decimal.mantissa === BigInt(0))
  ) {
    throw new RangeError("invalid_ohlcv_value");
  }
  return decimal.mantissa * BigInt(10) ** BigInt(OUTPUT_SCALE - decimal.scale);
}

function parsePositiveDecimal(value: string): bigint {
  return parseScaledDecimal(value, false);
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RangeError("invalid_market_date");
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("invalid_market_date");
  }
  return value;
}

function requireText(value: string): void {
  if (!value.trim()) throw new RangeError("missing_ohlcv_provenance");
}

function isVerifiableSource(source: {
  dataClass: OhlcvDataClass;
  verificationStatus: VerificationStatus;
}): boolean {
  return (
    source.verificationStatus === "VERIFIED" &&
    source.dataClass !== "FIXTURE" &&
    source.dataClass !== "NOT_VERIFIED"
  );
}

function metric<T>(value: T): MetricValue<T> {
  return { value, status: "AVAILABLE" };
}

function unavailableMetric<T>(
  status: Exclude<MetricStatus, "AVAILABLE">,
): MetricValue<T> {
  return { value: null, status };
}

function gapIndicators(): Indicators {
  return {
    simpleMovingAverage: unavailableMetric("GAP"),
    averageTrueRange14: unavailableMetric("GAP"),
    dailyReturn: unavailableMetric("GAP"),
    dailyLogReturn: unavailableMetric("GAP"),
    realizedVolatility: unavailableMetric("GAP"),
    logReturnQuantiles: unavailableMetric("GAP"),
    relativeStrengthIndex14: unavailableMetric("GAP"),
  };
}

function absolute(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}

function multiplyScaled(left: bigint, right: bigint): bigint {
  return divideRounded(left * right, SCALE);
}

function logReturnScaled(current: bigint, previous: bigint): bigint {
  const difference = current - previous;
  const ratioDeltaScaled = divideRounded(
    absolute(difference) * LOG_RATIO_SCALE,
    previous,
  );
  const ratioDelta = Number(ratioDeltaScaled) / Number(LOG_RATIO_SCALE);
  const logReturn = Math.log1p((difference < BigInt(0) ? -1 : 1) * ratioDelta);
  if (!Number.isFinite(logReturn)) throw new RangeError("invalid_log_return");
  return BigInt(
    Math.sign(logReturn) * Math.round(Math.abs(logReturn) * Number(SCALE)),
  );
}

function integerSquareRoot(value: bigint): bigint {
  if (value < BigInt(0)) throw new RangeError("invalid_square_root");
  if (value < BigInt(2)) return value;

  let estimate = value;
  let next = (estimate + BigInt(1)) / BigInt(2);
  while (next < estimate) {
    estimate = next;
    next = (estimate + value / estimate) / BigInt(2);
  }
  return estimate;
}

function roundedSquareRoot(value: bigint): bigint {
  const lower = integerSquareRoot(value);
  const upper = lower + BigInt(1);
  return value - lower * lower < upper * upper - value ? lower : upper;
}

function quantiles(values: readonly bigint[]) {
  const sorted = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const at = (percentile: bigint) => {
    const position = BigInt(sorted.length - 1) * percentile;
    const lowerIndex = Number(position / BigInt(100));
    const remainder = position % BigInt(100);
    const lower = sorted[lowerIndex];
    const upper = sorted[Math.min(lowerIndex + 1, sorted.length - 1)];
    return formatScaled(
      lower + divideRounded((upper - lower) * remainder, BigInt(100)),
    );
  };
  return { p05: at(BigInt(5)), p50: at(BigInt(50)), p95: at(BigInt(95)) };
}

function parseBar(bar: OhlcvBarInput): ParsedBar {
  parseDate(bar.date);
  requireText(bar.sourceRecordId);
  if (!/^\d+$/.test(bar.volume)) throw new RangeError("invalid_ohlcv_volume");
  const openScaled = parsePositiveDecimal(bar.open);
  const highScaled = parsePositiveDecimal(bar.high);
  const lowScaled = parsePositiveDecimal(bar.low);
  const closeScaled = parsePositiveDecimal(bar.close);
  if (
    highScaled < openScaled ||
    highScaled < closeScaled ||
    lowScaled > openScaled ||
    lowScaled > closeScaled ||
    highScaled < lowScaled
  ) {
    throw new RangeError("invalid_ohlcv_range");
  }
  return {
    ...bar,
    openScaled,
    highScaled,
    lowScaled,
    closeScaled,
    volumeScaled: BigInt(bar.volume) * SCALE,
  };
}

export function normalizeOhlcv(input: OhlcvInput): NormalizedOhlcvSeries {
  requireText(input.source.sourceId);
  requireText(input.expectedSessions.sourceId);
  requireText(input.expectedSessions.calendarVersion);
  requireText(input.adjustment.sourceId);
  requireText(input.adjustment.sourceRecordId);
  if (
    !isVerifiableSource(input.source) &&
    input.source.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_data_class_cannot_be_verified");
  }
  if (
    !isVerifiableSource(input.adjustment) &&
    input.adjustment.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_adjustment_cannot_be_verified");
  }
  if (
    !Number.isSafeInteger(input.indicatorWindows.movingAverage) ||
    input.indicatorWindows.movingAverage < 1 ||
    !Number.isSafeInteger(input.indicatorWindows.returns) ||
    input.indicatorWindows.returns < 2
  ) {
    throw new RangeError("invalid_indicator_window");
  }
  if (input.expectedSessions.sessions.length === 0 || input.bars.length === 0) {
    throw new RangeError("empty_ohlcv_series");
  }

  const sessionDates = input.expectedSessions.sessions.map(
    ({ date, closeAtMs }) => {
      parseDate(date);
      if (
        !Number.isSafeInteger(closeAtMs) ||
        marketDateAt(closeAtMs, input.market) !== date
      ) {
        throw new RangeError("invalid_expected_session_close");
      }
      return date;
    },
  );
  for (let index = 1; index < sessionDates.length; index += 1) {
    if (sessionDates[index - 1] >= sessionDates[index]) {
      throw new RangeError("expected_sessions_not_ascending");
    }
  }
  const sessionDateSet = new Set(sessionDates);
  const sessionCloseAtMs = new Map(
    input.expectedSessions.sessions.map(({ date, closeAtMs }) => [
      date,
      closeAtMs,
    ]),
  );
  const parsedBars = new Map<string, ParsedBar>();
  const sourceRecordIds = new Set<string>();
  for (const bar of input.bars) {
    const parsed = parseBar(bar);
    if (parsedBars.has(parsed.date))
      throw new RangeError("duplicate_ohlcv_date");
    if (sourceRecordIds.has(parsed.sourceRecordId)) {
      throw new RangeError("duplicate_ohlcv_record");
    }
    if (!sessionDateSet.has(parsed.date))
      throw new RangeError("bar_outside_expected_sessions");
    const closeAtMs = sessionCloseAtMs.get(parsed.date)!;
    if (
      parsed.availableAtMs !== null &&
      (!Number.isSafeInteger(parsed.availableAtMs) ||
        parsed.availableAtMs < closeAtMs)
    ) {
      throw new RangeError("invalid_bar_availability_time");
    }
    sourceRecordIds.add(parsed.sourceRecordId);
    parsedBars.set(parsed.date, parsed);
  }

  const actionRecordIds = new Set<string>();
  const actions = input.adjustment.actions
    .map((action): ParsedAction => {
      parseDate(action.effectiveDate);
      if (!Number.isSafeInteger(action.knownAtMs)) {
        throw new RangeError("invalid_action_availability_time");
      }
      requireText(action.sourceRecordId);
      if (actionRecordIds.has(action.sourceRecordId)) {
        throw new RangeError("duplicate_adjustment_record");
      }
      actionRecordIds.add(action.sourceRecordId);
      const priceFactorScaled = parsePositiveDecimal(action.priceFactor);
      const volumeFactorScaled = parsePositiveDecimal(action.volumeFactor);
      if (action.kind === "CASH_DIVIDEND" && volumeFactorScaled !== SCALE) {
        throw new RangeError("dividend_volume_factor_must_be_one");
      }
      return { ...action, priceFactorScaled, volumeFactorScaled };
    })
    .sort(
      (left, right) =>
        left.effectiveDate.localeCompare(right.effectiveDate) ||
        left.sourceRecordId.localeCompare(right.sourceRecordId),
    );

  const actionIndexes = new Map<number, ParsedAction[]>();
  const lateActions: ParsedAction[] = [];
  if (input.adjustment.basis === "RAW") {
    for (const action of actions) {
      if (
        action.kind !== "SPLIT" ||
        action.effectiveDate <= sessionDates[0] ||
        action.effectiveDate > sessionDates.at(-1)!
      ) {
        continue;
      }
      const index = sessionDates.findIndex(
        (date) => date >= action.effectiveDate,
      );
      if (index <= 0) continue;
      const effectiveBar = parsedBars.get(sessionDates[index]);
      if (
        !effectiveBar ||
        effectiveBar.availableAtMs === null ||
        action.knownAtMs > effectiveBar.availableAtMs
      ) {
        lateActions.push(action);
        continue;
      }
      const atIndex = actionIndexes.get(index) ?? [];
      atIndex.push(action);
      actionIndexes.set(index, atIndex);
    }
  }

  const adjustmentSourceVerified = isVerifiableSource(input.adjustment);
  const adjustmentStatus: VerificationStatus =
    input.adjustment.basis === "RAW" &&
    input.adjustment.coverage === "COMPLETE" &&
    adjustmentSourceVerified &&
    lateActions.length === 0
      ? "VERIFIED"
      : "NOT_VERIFIED";
  const sourceVerified = isVerifiableSource(input.source);
  const calendarVerified =
    input.expectedSessions.verificationStatus === "VERIFIED";
  const coverageVerified =
    input.adjustment.basis === "RAW" &&
    input.adjustment.coverage === "COMPLETE" &&
    adjustmentSourceVerified;

  let previousClose: bigint | null = null;
  let wasGap = false;
  let closeWindow: bigint[] = [];
  let logReturnWindow: bigint[] = [];
  let trueRangeSeed = BigInt(0);
  let trueRangeCount = 0;
  let atr: bigint | null = null;
  let gainSeed = BigInt(0);
  let lossSeed = BigInt(0);
  let rsiChangeCount = 0;
  let averageGain: bigint | null = null;
  let averageLoss: bigint | null = null;
  let appliedAdjustmentRecordIds = new Set<string>();

  const sessions = sessionDates.map(
    (date, sessionIndex): NormalizedOhlcvSession => {
      for (const action of actionIndexes.get(sessionIndex) ?? []) {
        if (previousClose !== null) {
          previousClose = multiplyScaled(
            previousClose,
            action.priceFactorScaled,
          );
          closeWindow = closeWindow.map((value) =>
            multiplyScaled(value, action.priceFactorScaled),
          );
          trueRangeSeed = multiplyScaled(
            trueRangeSeed,
            action.priceFactorScaled,
          );
          if (atr !== null) atr = multiplyScaled(atr, action.priceFactorScaled);
          gainSeed = multiplyScaled(gainSeed, action.priceFactorScaled);
          lossSeed = multiplyScaled(lossSeed, action.priceFactorScaled);
          if (averageGain !== null)
            averageGain = multiplyScaled(averageGain, action.priceFactorScaled);
          if (averageLoss !== null)
            averageLoss = multiplyScaled(averageLoss, action.priceFactorScaled);
          appliedAdjustmentRecordIds.add(action.sourceRecordId);
        }
      }

      const parsed = parsedBars.get(date);
      const pointInTimeAdjustmentVerified = !lateActions.some(
        (action) => action.effectiveDate <= date,
      );
      const verificationStatus: VerificationStatus =
        sourceVerified &&
        calendarVerified &&
        coverageVerified &&
        pointInTimeAdjustmentVerified &&
        parsed !== undefined &&
        parsed.availableAtMs !== null
          ? "VERIFIED"
          : "NOT_VERIFIED";

      if (!parsed) {
        previousClose = null;
        wasGap = true;
        closeWindow = [];
        logReturnWindow = [];
        trueRangeSeed = BigInt(0);
        trueRangeCount = 0;
        atr = null;
        gainSeed = BigInt(0);
        lossSeed = BigInt(0);
        rsiChangeCount = 0;
        averageGain = null;
        averageLoss = null;
        appliedAdjustmentRecordIds = new Set();
        return {
          date,
          sessionIndex,
          signalAtMs: null,
          status: "GAP",
          verificationStatus: "NOT_VERIFIED",
          adjustmentRecordIdsAppliedToIndicators: [],
          bar: null,
          indicators: gapIndicators(),
        };
      }

      const open = parsed.openScaled;
      const high = parsed.highScaled;
      const low = parsed.lowScaled;
      const close = parsed.closeScaled;
      const dailyReturn =
        previousClose === null
          ? null
          : divideRounded((close - previousClose) * SCALE, previousClose);
      const dailyLogReturn =
        previousClose === null ? null : logReturnScaled(close, previousClose);
      const trueRange =
        previousClose === null
          ? null
          : [
              high - low,
              absolute(high - previousClose),
              absolute(low - previousClose),
            ].reduce((largest, candidate) =>
              candidate > largest ? candidate : largest,
            );

      if (trueRange !== null) {
        if (atr === null) {
          trueRangeSeed += trueRange;
          trueRangeCount += 1;
          if (trueRangeCount === ATR_PERIOD) {
            atr = divideRounded(trueRangeSeed, BigInt(ATR_PERIOD));
          }
        } else {
          atr = divideRounded(
            atr * BigInt(ATR_PERIOD - 1) + trueRange,
            BigInt(ATR_PERIOD),
          );
        }
      }

      if (previousClose !== null) {
        const change = close - previousClose;
        const gain = change > BigInt(0) ? change : BigInt(0);
        const loss = change < BigInt(0) ? -change : BigInt(0);
        if (averageGain === null || averageLoss === null) {
          gainSeed += gain;
          lossSeed += loss;
          rsiChangeCount += 1;
          if (rsiChangeCount === RSI_PERIOD) {
            averageGain = divideRounded(gainSeed, BigInt(RSI_PERIOD));
            averageLoss = divideRounded(lossSeed, BigInt(RSI_PERIOD));
          }
        } else {
          averageGain = divideRounded(
            averageGain * BigInt(RSI_PERIOD - 1) + gain,
            BigInt(RSI_PERIOD),
          );
          averageLoss = divideRounded(
            averageLoss * BigInt(RSI_PERIOD - 1) + loss,
            BigInt(RSI_PERIOD),
          );
        }
        if (dailyLogReturn !== null) {
          logReturnWindow.push(dailyLogReturn);
          if (logReturnWindow.length > input.indicatorWindows.returns)
            logReturnWindow.shift();
        }
      }

      closeWindow.push(close);
      if (closeWindow.length > input.indicatorWindows.movingAverage)
        closeWindow.shift();
      const insufficient = unavailableMetric<string>("INSUFFICIENT_HISTORY");
      const dailyReturnMetric =
        dailyReturn === null
          ? unavailableMetric<string>(wasGap ? "GAP" : "INSUFFICIENT_HISTORY")
          : metric(formatScaled(dailyReturn));
      const dailyLogReturnMetric =
        dailyLogReturn === null
          ? unavailableMetric<string>(wasGap ? "GAP" : "INSUFFICIENT_HISTORY")
          : metric(formatScaled(dailyLogReturn));
      const realizedVolatility: MetricValue<string> =
        logReturnWindow.length < input.indicatorWindows.returns
          ? insufficient
          : (() => {
              const sum = logReturnWindow.reduce(
                (total, value) => total + value,
                BigInt(0),
              );
              const sumSquares = logReturnWindow.reduce(
                (total, value) => total + value * value,
                BigInt(0),
              );
              const count = BigInt(logReturnWindow.length);
              const varianceNumerator = sumSquares * count - sum * sum;
              const varianceDenominator =
                count * BigInt(logReturnWindow.length - 1);
              return metric(
                formatScaled(
                  roundedSquareRoot(
                    divideRounded(varianceNumerator, varianceDenominator),
                  ),
                ),
              );
            })();
      const logReturnQuantiles: MetricValue<
        Readonly<{ p05: string; p50: string; p95: string }>
      > =
        logReturnWindow.length < input.indicatorWindows.returns
          ? unavailableMetric("INSUFFICIENT_HISTORY")
          : metric(quantiles(logReturnWindow));
      const rsiValue =
        averageGain === null || averageLoss === null
          ? null
          : averageGain === BigInt(0) && averageLoss === BigInt(0)
            ? BigInt(50) * SCALE
            : divideRounded(
                averageGain * BigInt(100) * SCALE,
                averageGain + averageLoss,
              );

      previousClose = close;
      wasGap = false;
      return {
        date,
        sessionIndex,
        signalAtMs: parsed.availableAtMs,
        status: "PRESENT",
        verificationStatus,
        adjustmentRecordIdsAppliedToIndicators: [...appliedAdjustmentRecordIds],
        bar: {
          date,
          availableAtMs: parsed.availableAtMs,
          sourceRecordId: parsed.sourceRecordId,
          open: formatScaled(open),
          high: formatScaled(high),
          low: formatScaled(low),
          close: formatScaled(close),
          volume: formatScaled(parsed.volumeScaled),
        },
        indicators: {
          simpleMovingAverage:
            closeWindow.length < input.indicatorWindows.movingAverage
              ? insufficient
              : metric(
                  formatScaled(
                    divideRounded(
                      closeWindow.reduce(
                        (total, value) => total + value,
                        BigInt(0),
                      ),
                      BigInt(input.indicatorWindows.movingAverage),
                    ),
                  ),
                ),
          averageTrueRange14:
            atr === null
              ? unavailableMetric("INSUFFICIENT_HISTORY")
              : metric(formatScaled(atr)),
          dailyReturn: dailyReturnMetric,
          dailyLogReturn: dailyLogReturnMetric,
          realizedVolatility,
          logReturnQuantiles,
          relativeStrengthIndex14:
            rsiValue === null
              ? unavailableMetric("INSUFFICIENT_HISTORY")
              : metric(formatScaled(rsiValue)),
        },
      };
    },
  );

  return {
    market: input.market,
    source: input.source,
    expectedSessions: input.expectedSessions,
    adjustment: input.adjustment,
    indicatorWindows: input.indicatorWindows,
    indicatorPriceBasis: "SPLIT_ADJUSTED_AS_OF_SESSION",
    adjustmentStatus,
    verificationStatus: sessions.every(
      (session) =>
        session.verificationStatus === "VERIFIED" &&
        session.status === "PRESENT",
    )
      ? "VERIFIED"
      : "NOT_VERIFIED",
    decimalScale: OUTPUT_SCALE,
    sessions,
  };
}
