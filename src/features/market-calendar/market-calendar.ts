import { MARKET_TIME_ZONES, marketDateAt } from "../../domain/primitives.ts";
import type { MarketCode, MarketDate } from "../../domain/primitives.ts";

export type MarketCalendarExchange = "NYSE" | "NASDAQ" | "TSE";

export type MarketCalendarOverride = Readonly<{
  exchange: MarketCalendarExchange;
  date: MarketDate;
  reason: string;
  sourceUrl: string;
  sourceVersion: string;
  checkedAt: string;
}>;

type MarketSessionWindow = Readonly<{
  openTime: string;
  closeTime: string;
  openAtMs: number;
  closeAtMs: number;
}>;

type CalendarDefinition = Readonly<{
  market: MarketCode;
  source: Readonly<{
    version: string;
    checkedAt: string;
    urls: readonly string[];
    firstYear: number;
    lastYear: number;
  }>;
  regularSessions: readonly Readonly<{ open: string; close: string }>[];
  holidays: readonly string[];
  earlyCloses: Readonly<Record<string, string>>;
}>;

const CALENDAR_CHECKED_AT = "2026-11-16T10:07:15.000Z";

const calendars: Record<MarketCalendarExchange, CalendarDefinition> = {
  NYSE: {
    market: "US",
    source: {
      version: "nyse-cash-2026-2028-as-of-2026-11-16",
      checkedAt: CALENDAR_CHECKED_AT,
      urls: ["https://www.nyse.com/trade/hours-calendars"],
      firstYear: 2026,
      lastYear: 2028,
    },
    regularSessions: [{ open: "09:30", close: "16:00" }],
    holidays: [
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26",
      "2027-05-31",
      "2027-06-18",
      "2027-07-05",
      "2027-09-06",
      "2027-11-25",
      "2027-12-24",
      "2028-01-17",
      "2028-02-21",
      "2028-04-14",
      "2028-05-29",
      "2028-06-19",
      "2028-07-04",
      "2028-09-04",
      "2028-11-23",
      "2028-12-25",
    ],
    earlyCloses: {
      "2026-11-27": "13:00",
      "2026-12-24": "13:00",
      "2027-11-26": "13:00",
      "2028-07-03": "13:00",
      "2028-11-24": "13:00",
    },
  },
  NASDAQ: {
    market: "US",
    source: {
      version: "nasdaq-us-cash-2026-as-of-2026-11-16",
      checkedAt: CALENDAR_CHECKED_AT,
      urls: [
        "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule",
      ],
      firstYear: 2026,
      lastYear: 2026,
    },
    regularSessions: [{ open: "09:30", close: "16:00" }],
    holidays: [
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ],
    earlyCloses: {
      "2026-11-27": "13:00",
      "2026-12-24": "13:00",
    },
  },
  TSE: {
    market: "JP",
    source: {
      version: "jpx-cash-equities-2026-2027-as-of-2026-11-16",
      checkedAt: CALENDAR_CHECKED_AT,
      urls: [
        "https://www.jpx.co.jp/english/corporate/about-jpx/calendar/index.html",
        "https://www.jpx.co.jp/english/equities/trading/domestic/01.html",
      ],
      firstYear: 2026,
      lastYear: 2027,
    },
    regularSessions: [
      { open: "09:00", close: "11:30" },
      { open: "12:30", close: "15:30" },
    ],
    holidays: [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-12",
      "2026-02-11",
      "2026-02-23",
      "2026-03-20",
      "2026-04-29",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-07-20",
      "2026-08-11",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-10-12",
      "2026-11-03",
      "2026-11-23",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-11",
      "2027-02-11",
      "2027-02-23",
      "2027-03-21",
      "2027-03-22",
      "2027-04-29",
      "2027-05-03",
      "2027-05-04",
      "2027-05-05",
      "2027-07-19",
      "2027-08-11",
      "2027-09-20",
      "2027-09-23",
      "2027-10-11",
      "2027-11-03",
      "2027-11-23",
      "2027-12-31",
    ],
    earlyCloses: {},
  },
};

const timeFormatters = {
  US: makeTimeFormatter(MARKET_TIME_ZONES.US),
  JP: makeTimeFormatter(MARKET_TIME_ZONES.JP),
} satisfies Record<MarketCode, Intl.DateTimeFormat>;

export type MarketCalendarState = Readonly<{
  exchange: MarketCalendarExchange;
  market: MarketCode;
  date: MarketDate;
  timeZone: string;
  status: "OPEN" | "CLOSED" | "CALENDAR_UNAVAILABLE";
  reason?:
    | "UNSUPPORTED_YEAR"
    | "WEEKEND"
    | "EXCHANGE_HOLIDAY"
    | "TEMPORARY_CLOSURE"
    | "INVALID_OVERRIDE"
    | "CONFLICTING_OVERRIDES"
    | "OUTSIDE_SESSION";
  calendarVersion: string;
  checkedAt: string;
  sourceUrls: readonly string[];
  temporaryClosure?: Readonly<{
    reason: string;
    sourceUrl: string;
    sourceVersion: string;
    checkedAt: string;
  }>;
  sessions: readonly MarketSessionWindow[];
  activeSession?: MarketSessionWindow;
}>;

function makeTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function localBoundaryAt(date: MarketDate, time: string, market: MarketCode) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Map(
    timeFormatters[market]
      .formatToParts(new Date(wallClockMs))
      .map(({ type, value }) => [type, value]),
  );
  const formattedWallClockMs = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")),
    Number(parts.get("minute")),
  );

  return wallClockMs - (formattedWallClockMs - wallClockMs);
}

function isWeekend(date: MarketDate): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validOverride(override: MarketCalendarOverride): boolean {
  if (
    typeof override.exchange !== "string" ||
    !Object.hasOwn(calendars, override.exchange) ||
    typeof override.date !== "string" ||
    typeof override.reason !== "string" ||
    typeof override.sourceUrl !== "string" ||
    typeof override.sourceVersion !== "string" ||
    typeof override.checkedAt !== "string" ||
    !isCalendarDate(override.date) ||
    !override.reason.trim() ||
    !override.sourceVersion.trim() ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      override.checkedAt,
    )
  ) {
    return false;
  }
  if (!isCalendarDate(override.checkedAt.slice(0, 10))) return false;

  const checkedAt = Date.parse(override.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;

  const officialDomains = {
    NYSE: ["nyse.com"],
    NASDAQ: ["nasdaq.com", "nasdaqtrader.com"],
    TSE: ["jpx.co.jp"],
  }[override.exchange];

  try {
    const url = new URL(override.sourceUrl);
    return (
      url.protocol === "https:" &&
      officialDomains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

function unavailable(
  exchange: MarketCalendarExchange,
  date: MarketDate,
  definition: CalendarDefinition,
  reason: NonNullable<MarketCalendarState["reason"]>,
): MarketCalendarState {
  return {
    exchange,
    market: definition.market,
    date,
    timeZone: MARKET_TIME_ZONES[definition.market],
    status: "CALENDAR_UNAVAILABLE",
    reason,
    calendarVersion: definition.source.version,
    checkedAt: definition.source.checkedAt,
    sourceUrls: definition.source.urls,
    sessions: [],
  };
}

export function marketCalendarStateAt(
  exchange: MarketCalendarExchange,
  instantMs: number,
  overrides: readonly MarketCalendarOverride[] = [],
): MarketCalendarState {
  if (!Number.isSafeInteger(instantMs)) {
    throw new RangeError("invalid_instant");
  }

  const definition = calendars[exchange];
  if (!definition) throw new RangeError("unsupported_exchange");
  const date = marketDateAt(instantMs, definition.market);
  const year = Number(date.slice(0, 4));
  const common = {
    exchange,
    market: definition.market,
    date,
    timeZone: MARKET_TIME_ZONES[definition.market],
    calendarVersion: definition.source.version,
    checkedAt: definition.source.checkedAt,
    sourceUrls: definition.source.urls,
  };

  if (year < definition.source.firstYear || year > definition.source.lastYear) {
    return unavailable(exchange, date, definition, "UNSUPPORTED_YEAR");
  }

  if (
    !Array.isArray(overrides) ||
    overrides.some(
      (override) =>
        !override ||
        typeof override !== "object" ||
        typeof override.exchange !== "string" ||
        !Object.hasOwn(calendars, override.exchange),
    )
  ) {
    return unavailable(exchange, date, definition, "INVALID_OVERRIDE");
  }

  const exchangeOverrides = overrides.filter(
    (override) => override.exchange === exchange,
  );
  if (exchangeOverrides.some((override) => !validOverride(override))) {
    return unavailable(exchange, date, definition, "INVALID_OVERRIDE");
  }

  const matchingOverrides = exchangeOverrides.filter(
    (override) => override.date === date,
  );
  if (matchingOverrides.length > 1) {
    return unavailable(exchange, date, definition, "CONFLICTING_OVERRIDES");
  }
  if (matchingOverrides.length === 1) {
    const [override] = matchingOverrides;
    return {
      ...common,
      status: "CLOSED",
      reason: "TEMPORARY_CLOSURE",
      sourceUrls: [...definition.source.urls, override.sourceUrl],
      temporaryClosure: {
        reason: override.reason,
        sourceUrl: override.sourceUrl,
        sourceVersion: override.sourceVersion,
        checkedAt: override.checkedAt,
      },
      sessions: [],
    };
  }

  if (definition.holidays.includes(date)) {
    return {
      ...common,
      status: "CLOSED",
      reason: "EXCHANGE_HOLIDAY",
      sessions: [],
    };
  }
  if (isWeekend(date)) {
    return {
      ...common,
      status: "CLOSED",
      reason: "WEEKEND",
      sessions: [],
    };
  }

  const earlyClose = definition.earlyCloses[date];
  const localSessions = definition.regularSessions.map((session, index) => ({
    openTime: session.open,
    closeTime:
      earlyClose && index === definition.regularSessions.length - 1
        ? earlyClose
        : session.close,
  }));
  const sessions = localSessions.map(({ closeTime, openTime }) => ({
    openTime,
    closeTime,
    openAtMs: localBoundaryAt(date, openTime, definition.market),
    closeAtMs: localBoundaryAt(date, closeTime, definition.market),
  }));
  const activeSession = sessions.find(
    (session) => session.openAtMs <= instantMs && instantMs < session.closeAtMs,
  );

  if (activeSession) {
    return { ...common, status: "OPEN", sessions, activeSession };
  }

  return {
    ...common,
    status: "CLOSED",
    reason: "OUTSIDE_SESSION",
    sessions,
  };
}

const dayMs = 24 * 60 * 60 * 1_000;

export function latestCompletedMarketSessionAt(
  exchange: MarketCalendarExchange,
  nowMs: number,
  overrides: readonly MarketCalendarOverride[] = [],
) {
  const market = exchange === "TSE" ? "JP" : "US";
  let date = marketCalendarStateAt(exchange, nowMs, overrides).date;

  for (let daysBack = 0; daysBack < 14; daysBack += 1) {
    const state = marketCalendarStateAt(
      exchange,
      Date.parse(`${date}T12:00:00.000Z`),
      overrides,
    );
    if (state.status === "CALENDAR_UNAVAILABLE") return null;

    const closeAtMs = state.sessions.at(-1)?.closeAtMs;
    if (closeAtMs !== undefined && closeAtMs <= nowMs) return state;

    date = marketDateAt(Date.parse(`${date}T12:00:00.000Z`) - dayMs, market);
  }

  return null;
}
