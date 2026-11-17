import { parseFixedDecimal } from "@/domain/primitives";
import type { MarketCode } from "@/domain/primitives";

const OUTPUT_SCALE = 8;
const SCALE = BigInt(10) ** BigInt(OUTPUT_SCALE);
const RSI_WINDOW = 14;
const ATR_WINDOW = 14;
const PRICE_WINDOW = 20;
const RETURN_WINDOW = 20;
const SQRT_252_SCALED = BigInt(Math.round(Math.sqrt(252) * Number(SCALE)));

export type OhlcvDataClass =
  "REAL" | "DELAYED" | "HISTORICAL" | "FIXTURE" | "NOT_VERIFIED";
export type VerificationStatus = "VERIFIED" | "NOT_VERIFIED";
export type OhlcvBarInput = Readonly<{
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  sourceRecordId: string;
}>;
export type CorporateActionAdjustment = Readonly<{
  effectiveDate: string;
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
    dates: readonly string[];
    sourceId: string;
    verificationStatus: VerificationStatus;
  }>;
  adjustment: Readonly<{
    basis: "RAW" | "SPLIT_ADJUSTED" | "TOTAL_RETURN_ADJUSTED" | "UNKNOWN";
    coverage: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
    sourceId: string;
    sourceRecordId: string;
    actions: readonly CorporateActionAdjustment[];
  }>;
  bars: readonly OhlcvBarInput[];
}>;

type MetricStatus = "AVAILABLE" | "INSUFFICIENT_HISTORY" | "GAP";
type MetricValue<T> = Readonly<{ value: T | null; status: MetricStatus }>;
type NormalizedBar = Readonly<{
  date: string;
  sourceRecordId: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  appliedAdjustmentRecordIds: readonly string[];
}>;
type Indicators = Readonly<{
  simpleMovingAverage20: MetricValue<string>;
  averageTrueRange14: MetricValue<string>;
  dailyReturn: MetricValue<string>;
  annualizedRealizedVolatility20: MetricValue<string>;
  dailyReturnQuantiles20: MetricValue<
    Readonly<{ p05: string; p50: string; p95: string }>
  >;
  relativeStrengthIndex14: MetricValue<string>;
}>;

export type NormalizedOhlcvSession = Readonly<{
  date: string;
  sessionIndex: number;
  status: "PRESENT" | "GAP";
  bar: NormalizedBar | null;
  indicators: Indicators;
}>;
export type NormalizedOhlcvSeries = Readonly<{
  market: MarketCode;
  source: OhlcvInput["source"];
  expectedSessions: OhlcvInput["expectedSessions"];
  adjustment: OhlcvInput["adjustment"];
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
    simpleMovingAverage20: unavailableMetric("GAP"),
    averageTrueRange14: unavailableMetric("GAP"),
    dailyReturn: unavailableMetric("GAP"),
    annualizedRealizedVolatility20: unavailableMetric("GAP"),
    dailyReturnQuantiles20: unavailableMetric("GAP"),
    relativeStrengthIndex14: unavailableMetric("GAP"),
  };
}

function absolute(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
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

function returnQuantile(values: readonly bigint[], percentile: bigint): bigint {
  const sorted = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const position = BigInt(sorted.length - 1) * percentile;
  const lowerIndex = Number(position / BigInt(100));
  const remainder = position % BigInt(100);
  const lower = sorted[lowerIndex];
  const upper = sorted[Math.min(lowerIndex + 1, sorted.length - 1)];
  return lower + divideRounded((upper - lower) * remainder, BigInt(100));
}

function parseBar(bar: OhlcvBarInput): Omit<
  NormalizedBar,
  "appliedAdjustmentRecordIds"
> & {
  openScaled: bigint;
  highScaled: bigint;
  lowScaled: bigint;
  closeScaled: bigint;
  volumeScaled: bigint;
} {
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
    date: bar.date,
    sourceRecordId: bar.sourceRecordId,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    openScaled,
    highScaled,
    lowScaled,
    closeScaled,
    volumeScaled: BigInt(bar.volume) * SCALE,
  };
}

function normalizedBar(
  bar: ReturnType<typeof parseBar>,
  adjustment: OhlcvInput["adjustment"],
): NormalizedBar {
  const actions = adjustment.actions
    .filter(
      (action) => adjustment.basis === "RAW" && bar.date < action.effectiveDate,
    )
    .map((action) => ({
      ...action,
      priceFactorScaled: parsePositiveDecimal(action.priceFactor),
      volumeFactorScaled: parsePositiveDecimal(action.volumeFactor),
    }));
  let price = SCALE;
  let volume = SCALE;
  for (const action of actions) {
    price = divideRounded(price * action.priceFactorScaled, SCALE);
    volume = divideRounded(volume * action.volumeFactorScaled, SCALE);
  }

  return {
    date: bar.date,
    sourceRecordId: bar.sourceRecordId,
    open: formatScaled(divideRounded(bar.openScaled * price, SCALE)),
    high: formatScaled(divideRounded(bar.highScaled * price, SCALE)),
    low: formatScaled(divideRounded(bar.lowScaled * price, SCALE)),
    close: formatScaled(divideRounded(bar.closeScaled * price, SCALE)),
    volume: formatScaled(divideRounded(bar.volumeScaled * volume, SCALE)),
    appliedAdjustmentRecordIds: actions.map(
      ({ sourceRecordId }) => sourceRecordId,
    ),
  };
}

export function normalizeOhlcv(input: OhlcvInput): NormalizedOhlcvSeries {
  requireText(input.source.sourceId);
  requireText(input.expectedSessions.sourceId);
  requireText(input.adjustment.sourceId);
  requireText(input.adjustment.sourceRecordId);
  if (
    (input.source.dataClass === "FIXTURE" ||
      input.source.dataClass === "NOT_VERIFIED") &&
    input.source.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_data_class_cannot_be_verified");
  }
  if (input.expectedSessions.dates.length === 0 || input.bars.length === 0) {
    throw new RangeError("empty_ohlcv_series");
  }

  const sessionDates = input.expectedSessions.dates.map(parseDate);
  for (let index = 1; index < sessionDates.length; index += 1) {
    if (sessionDates[index - 1] >= sessionDates[index]) {
      throw new RangeError("expected_sessions_not_ascending");
    }
  }
  const sessionIndexes = new Map(
    sessionDates.map((date, index) => [date, index]),
  );
  const parsedBars = new Map<string, ReturnType<typeof parseBar>>();
  const sourceRecordIds = new Set<string>();
  for (const bar of input.bars) {
    const parsed = parseBar(bar);
    if (parsedBars.has(parsed.date))
      throw new RangeError("duplicate_ohlcv_date");
    if (sourceRecordIds.has(parsed.sourceRecordId)) {
      throw new RangeError("duplicate_ohlcv_record");
    }
    if (!sessionIndexes.has(parsed.date))
      throw new RangeError("bar_outside_expected_sessions");
    sourceRecordIds.add(parsed.sourceRecordId);
    parsedBars.set(parsed.date, parsed);
  }

  const actionRecordIds = new Set<string>();
  for (const action of input.adjustment.actions) {
    parseDate(action.effectiveDate);
    requireText(action.sourceRecordId);
    if (actionRecordIds.has(action.sourceRecordId)) {
      throw new RangeError("duplicate_adjustment_record");
    }
    actionRecordIds.add(action.sourceRecordId);
    parsePositiveDecimal(action.priceFactor);
    parsePositiveDecimal(action.volumeFactor);
    if (
      action.kind === "CASH_DIVIDEND" &&
      parsePositiveDecimal(action.volumeFactor) !== SCALE
    ) {
      throw new RangeError("dividend_volume_factor_must_be_one");
    }
  }

  const adjustmentStatus: VerificationStatus =
    input.adjustment.basis !== "UNKNOWN" &&
    input.adjustment.coverage === "COMPLETE"
      ? "VERIFIED"
      : "NOT_VERIFIED";
  const verificationStatus: VerificationStatus =
    input.source.verificationStatus === "VERIFIED" &&
    input.source.dataClass !== "FIXTURE" &&
    input.source.dataClass !== "NOT_VERIFIED" &&
    input.expectedSessions.verificationStatus === "VERIFIED" &&
    adjustmentStatus === "VERIFIED"
      ? "VERIFIED"
      : "NOT_VERIFIED";

  let previousClose: bigint | null = null;
  let wasGap = false;
  let closeWindow: bigint[] = [];
  let returnWindow: bigint[] = [];
  let trueRangeSeed = BigInt(0);
  let trueRangeCount = 0;
  let atr: bigint | null = null;
  let gainSeed = BigInt(0);
  let lossSeed = BigInt(0);
  let rsiChangeCount = 0;
  let averageGain: bigint | null = null;
  let averageLoss: bigint | null = null;

  const sessions = sessionDates.map(
    (date, sessionIndex): NormalizedOhlcvSession => {
      const parsed = parsedBars.get(date);
      if (!parsed) {
        previousClose = null;
        wasGap = true;
        closeWindow = [];
        returnWindow = [];
        trueRangeSeed = BigInt(0);
        trueRangeCount = 0;
        atr = null;
        gainSeed = BigInt(0);
        lossSeed = BigInt(0);
        rsiChangeCount = 0;
        averageGain = null;
        averageLoss = null;
        return {
          date,
          sessionIndex,
          status: "GAP",
          bar: null,
          indicators: gapIndicators(),
        };
      }

      const bar = normalizedBar(parsed, input.adjustment);
      const open = parsePositiveDecimal(bar.open);
      const high = parsePositiveDecimal(bar.high);
      const low = parsePositiveDecimal(bar.low);
      const close = parsePositiveDecimal(bar.close);
      const volume = parseScaledDecimal(bar.volume, true);
      const dailyReturn =
        previousClose === null
          ? null
          : divideRounded((close - previousClose) * SCALE, previousClose);

      const trueRange =
        previousClose === null
          ? high - low
          : [
              high - low,
              absolute(high - previousClose),
              absolute(low - previousClose),
            ].reduce((largest, candidate) =>
              candidate > largest ? candidate : largest,
            );
      if (atr === null) {
        trueRangeSeed += trueRange;
        trueRangeCount += 1;
        if (trueRangeCount === ATR_WINDOW) {
          atr = divideRounded(trueRangeSeed, BigInt(ATR_WINDOW));
        }
      } else {
        atr = divideRounded(
          atr * BigInt(ATR_WINDOW - 1) + trueRange,
          BigInt(ATR_WINDOW),
        );
      }

      if (previousClose !== null) {
        const change = close - previousClose;
        const gain = change > BigInt(0) ? change : BigInt(0);
        const loss = change < BigInt(0) ? -change : BigInt(0);
        if (averageGain === null || averageLoss === null) {
          gainSeed += gain;
          lossSeed += loss;
          rsiChangeCount += 1;
          if (rsiChangeCount === RSI_WINDOW) {
            averageGain = divideRounded(gainSeed, BigInt(RSI_WINDOW));
            averageLoss = divideRounded(lossSeed, BigInt(RSI_WINDOW));
          }
        } else {
          averageGain = divideRounded(
            averageGain * BigInt(RSI_WINDOW - 1) + gain,
            BigInt(RSI_WINDOW),
          );
          averageLoss = divideRounded(
            averageLoss * BigInt(RSI_WINDOW - 1) + loss,
            BigInt(RSI_WINDOW),
          );
        }
        if (dailyReturn !== null) {
          returnWindow.push(dailyReturn);
          if (returnWindow.length > RETURN_WINDOW) returnWindow.shift();
        }
      }

      closeWindow.push(close);
      if (closeWindow.length > PRICE_WINDOW) closeWindow.shift();
      const dailyReturnMetric =
        dailyReturn === null
          ? unavailableMetric<string>(wasGap ? "GAP" : "INSUFFICIENT_HISTORY")
          : metric(formatScaled(dailyReturn));
      const volatilityMetric: MetricValue<string> =
        returnWindow.length < RETURN_WINDOW
          ? unavailableMetric("INSUFFICIENT_HISTORY")
          : (() => {
              const sum = returnWindow.reduce(
                (total, value) => total + value,
                BigInt(0),
              );
              const sumSquares = returnWindow.reduce(
                (total, value) => total + value * value,
                BigInt(0),
              );
              const count = BigInt(returnWindow.length);
              const varianceNumerator = sumSquares * count - sum * sum;
              const varianceDenominator =
                count * BigInt(returnWindow.length - 1);
              const standardDeviation = roundedSquareRoot(
                divideRounded(varianceNumerator, varianceDenominator),
              );
              return metric(
                formatScaled(
                  divideRounded(standardDeviation * SQRT_252_SCALED, SCALE),
                ),
              );
            })();
      const quantilesMetric: MetricValue<
        Readonly<{ p05: string; p50: string; p95: string }>
      > =
        returnWindow.length < RETURN_WINDOW
          ? unavailableMetric("INSUFFICIENT_HISTORY")
          : metric({
              p05: formatScaled(returnQuantile(returnWindow, BigInt(5))),
              p50: formatScaled(returnQuantile(returnWindow, BigInt(50))),
              p95: formatScaled(returnQuantile(returnWindow, BigInt(95))),
            });
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
        status: "PRESENT",
        bar: {
          ...bar,
          open: formatScaled(open),
          high: formatScaled(high),
          low: formatScaled(low),
          close: formatScaled(close),
          volume: formatScaled(volume),
        },
        indicators: {
          simpleMovingAverage20:
            closeWindow.length < PRICE_WINDOW
              ? unavailableMetric("INSUFFICIENT_HISTORY")
              : metric(
                  formatScaled(
                    divideRounded(
                      closeWindow.reduce(
                        (total, value) => total + value,
                        BigInt(0),
                      ),
                      BigInt(PRICE_WINDOW),
                    ),
                  ),
                ),
          averageTrueRange14:
            atr === null
              ? unavailableMetric("INSUFFICIENT_HISTORY")
              : metric(formatScaled(atr)),
          dailyReturn: dailyReturnMetric,
          annualizedRealizedVolatility20: volatilityMetric,
          dailyReturnQuantiles20: quantilesMetric,
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
    adjustmentStatus,
    verificationStatus,
    decimalScale: OUTPUT_SCALE,
    sessions,
  };
}
