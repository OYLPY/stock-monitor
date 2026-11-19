import { marketCalendarStateAt } from "../market-calendar/market-calendar.ts";
import { getLocalDatabasePath, openDatabase } from "../../db/index.ts";
import {
  collectBojRss,
  collectFederalReserveRss,
} from "../../providers/disclosures/index.ts";
import type { TaskHandler, TaskHandlerContext } from "../task-queue/types.ts";
import {
  MARKET_WATCH_SOURCE_KEYS,
  processMarketWatchAlerts,
  readMarketWatchSourceWatermarks,
} from "../alerts/alerts.ts";
import { normalizeOfficialRssEvents } from "../events/normalizer.ts";

const TARGET_EXCHANGES = ["NYSE", "NASDAQ", "TSE"] as const;

export function marketWatchDecisionAt(asOfMs: number) {
  const calendars = TARGET_EXCHANGES.map((exchange) =>
    marketCalendarStateAt(exchange, asOfMs),
  );
  const openExchanges = calendars
    .filter((calendar) => calendar.status === "OPEN")
    .map(({ exchange }) => exchange);
  const calendarUnavailable = calendars.some(
    (calendar) => calendar.status === "CALENDAR_UNAVAILABLE",
  );
  const executionStatus: "BLOCKED_EXTERNAL" | "SKIPPED" =
    calendarUnavailable || openExchanges.length > 0
      ? "BLOCKED_EXTERNAL"
      : "SKIPPED";
  const resultCode:
    "CALENDAR_UNAVAILABLE" | "SOURCE_UNAVAILABLE" | "SKIPPED_CLOSED" =
    calendarUnavailable
      ? "CALENDAR_UNAVAILABLE"
      : openExchanges.length > 0
        ? "SOURCE_UNAVAILABLE"
        : "SKIPPED_CLOSED";

  return {
    executionStatus,
    resultCode,
    ...(executionStatus === "BLOCKED_EXTERNAL"
      ? { errorCode: resultCode }
      : {}),
    details: {
      asOfMs,
      openExchanges,
      signalEvaluation: "NOT_RUN",
      marketDataFreshness:
        openExchanges.length > 0 ? "NOT_VERIFIED" : "NOT_REQUESTED",
      calendars: calendars.map((calendar) => ({
        exchange: calendar.exchange,
        market: calendar.market,
        date: calendar.date,
        timeZone: calendar.timeZone,
        status: calendar.status,
        reason: calendar.reason ?? null,
        calendarVersion: calendar.calendarVersion,
        checkedAt: calendar.checkedAt,
        sourceUrls: [...calendar.sourceUrls],
        activeSession: calendar.activeSession
          ? {
              openTime: calendar.activeSession.openTime,
              closeTime: calendar.activeSession.closeTime,
              openAtMs: calendar.activeSession.openAtMs,
              closeAtMs: calendar.activeSession.closeAtMs,
            }
          : null,
      })),
    },
  };
}

export const marketWatchHandler: TaskHandler = async (context) => {
  const { signal } = context;
  if (signal.aborted) {
    return { executionStatus: "SKIPPED", resultCode: "CANCELLED" };
  }

  const scanAtMs = Date.now();
  const decision = marketWatchDecisionAt(scanAtMs);
  if (decision.resultCode !== "SOURCE_UNAVAILABLE") return decision;

  const database = await openDatabase(getLocalDatabasePath());
  try {
    return await runMarketWatchTask(database, context, fetch, scanAtMs);
  } finally {
    database.client.close();
  }
};

export async function runMarketWatchTask(
  database: Awaited<ReturnType<typeof openDatabase>>,
  context: Pick<TaskHandlerContext, "signal" | "taskRunId">,
  fetcher: typeof fetch = fetch,
  scanAtMs = Date.now(),
) {
  if (context.signal.aborted) {
    return { executionStatus: "SKIPPED" as const, resultCode: "CANCELLED" };
  }

  const decision = marketWatchDecisionAt(scanAtMs);
  if (decision.resultCode !== "SOURCE_UNAVAILABLE") return decision;

  const previousWatermarks = readMarketWatchSourceWatermarks(database);
  const [federalReserve, bankOfJapan] = await Promise.all([
    collectFederalReserveRss(
      database,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      fetcher,
    ),
    collectBojRss(
      database,
      { feedUrl: "https://www.boj.or.jp/en/rss/whatsnew.xml" },
      fetcher,
    ),
  ]);

  if (context.signal.aborted) {
    return { executionStatus: "SKIPPED" as const, resultCode: "CANCELLED" };
  }

  const collectedAtMs = Date.now();
  const normalization = normalizeOfficialRssEvents(
    database,
    [...federalReserve.records, ...bankOfJapan.records],
    collectedAtMs,
  );
  const activeMarkets = new Set(
    decision.details.openExchanges.map((exchange) =>
      exchange === "TSE" ? "JP" : "US",
    ),
  );
  const alerts = processMarketWatchAlerts(database, {
    taskRunId: context.taskRunId,
    asOfMs: collectedAtMs,
    openMarkets: [...activeMarkets],
    previousWatermarks,
    sourceStates: [
      { sourceKey: MARKET_WATCH_SOURCE_KEYS[0], status: bankOfJapan.status },
      { sourceKey: MARKET_WATCH_SOURCE_KEYS[1], status: federalReserve.status },
    ],
  });

  return {
    ...decision,
    details: {
      ...decision.details,
      rssSources: {
        federalReserve: {
          status: federalReserve.status,
          reason: federalReserve.reason,
          records: federalReserve.records.length,
        },
        bankOfJapan: {
          status: bankOfJapan.status,
          reason: bankOfJapan.reason,
          records: bankOfJapan.records.length,
        },
      },
      eventNormalization: normalization,
      alerts,
      sourceKeys: MARKET_WATCH_SOURCE_KEYS,
    },
  };
}
