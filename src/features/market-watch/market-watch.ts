import { marketCalendarStateAt } from "../market-calendar/market-calendar.ts";
import type { TaskHandler } from "../task-queue/types.ts";

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
        openExchanges.length > 0 ? "UNKNOWN" : "NOT_REQUESTED",
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

export const marketWatchHandler: TaskHandler = async ({ signal }) => {
  if (signal.aborted) {
    return { executionStatus: "SKIPPED", resultCode: "CANCELLED" };
  }

  // shortcut: market data providers are not registered, so open windows stay blocked until a validated source SLA is available.
  return marketWatchDecisionAt(Date.now());
};
