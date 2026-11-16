const CURRENCY_MINOR_DIGITS = {
  JPY: 0,
  USD: 2,
} as const;

const MARKET_TIME_ZONES = {
  JP: "Asia/Tokyo",
  US: "America/New_York",
} as const;

// shortcut: only V1 target markets are mapped; add zones when new markets are approved.
const MARKET_TIME_FORMATTERS = {
  JP: new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone: MARKET_TIME_ZONES.JP,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }),
  US: new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone: MARKET_TIME_ZONES.US,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }),
} as const;

const MAX_DECIMAL_SCALE = 8;
const MAX_POWER_OF_TEN = MAX_DECIMAL_SCALE + 2;

export type CurrencyCode = keyof typeof CURRENCY_MINOR_DIGITS;
export type MarketCode = keyof typeof MARKET_TIME_ZONES;
declare const marketDateBrand: unique symbol;
export type MarketDate = string & { readonly [marketDateBrand]: true };
export type RoundingMode = "CEIL" | "FLOOR" | "HALF_AWAY_FROM_ZERO";

export type MarketDateTime = Readonly<{
  instantMs: number;
  market: MarketCode;
  timeZone: (typeof MARKET_TIME_ZONES)[MarketCode];
  localDate: MarketDate;
  localTime: string;
}>;

export type FixedDecimal = Readonly<{
  mantissa: bigint;
  scale: number;
}>;

export type Money = Readonly<{
  amountMinor: bigint;
  currency: CurrencyCode;
}>;

export type FxRate = FixedDecimal &
  Readonly<{
    baseCurrency: CurrencyCode;
    quoteCurrency: CurrencyCode;
  }>;

export type InstrumentIdentifier = Readonly<{
  market: MarketCode;
  exchangeCode: string;
  symbol: string;
}>;

function powerOfTen(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_POWER_OF_TEN) {
    throw new RangeError("invalid_decimal_scale");
  }

  return BigInt(10) ** BigInt(scale);
}

function currencyMinorDigits(currency: CurrencyCode): number {
  const scale = CURRENCY_MINOR_DIGITS[currency];
  if (scale === undefined) throw new RangeError("unsupported_currency");
  return scale;
}

function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === BigInt(0)) return quotient;

  if (mode === "CEIL") {
    return numerator > BigInt(0) ? quotient + BigInt(1) : quotient;
  }
  if (mode === "FLOOR") {
    return numerator < BigInt(0) ? quotient - BigInt(1) : quotient;
  }
  if (mode === "HALF_AWAY_FROM_ZERO") {
    const absoluteRemainder = remainder < BigInt(0) ? -remainder : remainder;
    if (absoluteRemainder * BigInt(2) >= denominator) {
      return quotient + (numerator < BigInt(0) ? -BigInt(1) : BigInt(1));
    }
    return quotient;
  }

  throw new RangeError("unsupported_rounding_mode");
}

export function marketDateTimeAt(
  instantMs: number,
  market: MarketCode,
): MarketDateTime {
  if (!Number.isSafeInteger(instantMs)) {
    throw new RangeError("invalid_instant");
  }

  const date = new Date(instantMs);
  if (Number.isNaN(date.getTime())) throw new RangeError("invalid_instant");

  const formatter = MARKET_TIME_FORMATTERS[market];
  const timeZone = MARKET_TIME_ZONES[market];
  if (!formatter || !timeZone) throw new RangeError("unsupported_market");

  const parts = new Map(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  const year = parts.get("year")!.padStart(4, "0");
  const month = parts.get("month")!;
  const day = parts.get("day")!;
  const hour = parts.get("hour")!;
  const minute = parts.get("minute")!;
  const second = parts.get("second")!;
  const millisecond = String(date.getUTCMilliseconds()).padStart(3, "0");

  return {
    instantMs,
    market,
    timeZone,
    localDate: (year + "-" + month + "-" + day) as MarketDate,
    localTime: hour + ":" + minute + ":" + second + "." + millisecond,
  };
}

export function marketDateAt(
  instantMs: number,
  market: MarketCode,
): MarketDate {
  // shortcut: this is a local calendar date; use the market calendar for sessions and holidays.
  return marketDateTimeAt(instantMs, market).localDate;
}

export function parseFixedDecimal(value: string): FixedDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new RangeError("invalid_decimal");

  const fraction = match[3] ?? "";
  if (fraction.length > MAX_DECIMAL_SCALE) {
    throw new RangeError("invalid_decimal_scale");
  }

  const sign = match[1] === "-" ? "-" : "";
  return {
    mantissa: BigInt(sign + match[2] + fraction),
    scale: fraction.length,
  };
}

export function moneyFromDecimal(
  value: string,
  currency: CurrencyCode,
  roundingMode: RoundingMode,
): Money {
  const { mantissa, scale } = parseFixedDecimal(value);
  const currencyScale = currencyMinorDigits(currency);
  const scaleDifference = currencyScale - scale;
  const amountMinor =
    scaleDifference >= 0
      ? mantissa * powerOfTen(scaleDifference)
      : divideRounded(mantissa, powerOfTen(-scaleDifference), roundingMode);

  return { amountMinor, currency };
}

export function parseFxRate(
  baseCurrency: CurrencyCode,
  quoteCurrency: CurrencyCode,
  value: string,
): FxRate {
  currencyMinorDigits(baseCurrency);
  currencyMinorDigits(quoteCurrency);
  if (baseCurrency === quoteCurrency) {
    throw new RangeError("fx_currencies_must_differ");
  }

  const decimal = parseFixedDecimal(value);
  if (decimal.mantissa <= BigInt(0)) throw new RangeError("invalid_fx_rate");

  return { ...decimal, baseCurrency, quoteCurrency };
}

export function convertMoney(
  money: Money,
  rate: FxRate,
  roundingMode: RoundingMode,
): Money {
  if (money.currency !== rate.baseCurrency) {
    throw new RangeError("fx_base_currency_mismatch");
  }

  if (rate.baseCurrency === rate.quoteCurrency) {
    throw new RangeError("fx_currencies_must_differ");
  }
  if (typeof rate.mantissa !== "bigint" || rate.mantissa <= BigInt(0)) {
    throw new RangeError("invalid_fx_rate");
  }
  if (
    !Number.isInteger(rate.scale) ||
    rate.scale < 0 ||
    rate.scale > MAX_DECIMAL_SCALE
  ) {
    throw new RangeError("invalid_decimal_scale");
  }

  const baseScale = currencyMinorDigits(rate.baseCurrency);
  const quoteScale = currencyMinorDigits(rate.quoteCurrency);
  const numerator = money.amountMinor * rate.mantissa * powerOfTen(quoteScale);
  const denominator = powerOfTen(baseScale + rate.scale);

  return {
    amountMinor: divideRounded(numerator, denominator, roundingMode),
    currency: rate.quoteCurrency,
  };
}

function normalizeIdentifierPart(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new RangeError("invalid_instrument_identifier");
  }
  return normalized;
}

export function instrumentCompositeKey(
  identifier: InstrumentIdentifier,
): string {
  if (!MARKET_TIME_ZONES[identifier.market]) {
    throw new RangeError("unsupported_market");
  }

  return JSON.stringify([
    identifier.market,
    normalizeIdentifierPart(identifier.exchangeCode),
    normalizeIdentifierPart(identifier.symbol),
  ]);
}
