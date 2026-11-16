import { describe, expect, it } from "vitest";
import { marketDateAt } from "@/domain/primitives";
import {
  marketCalendarStateAt,
  type MarketCalendarOverride,
} from "./market-calendar";

function instant(value: string): number {
  return Date.parse(value);
}

describe("marketCalendarStateAt", () => {
  it.each([
    ["2026-03-06T14:30:00.000Z", "EST before spring DST"],
    ["2026-03-09T13:30:00.000Z", "EDT after spring DST"],
    ["2026-10-30T13:30:00.000Z", "EDT before fall DST"],
    ["2026-11-02T14:30:00.000Z", "EST after fall DST"],
  ])("maps NYSE core open through %s (%s)", (value) => {
    const state = marketCalendarStateAt("NYSE", instant(value));

    expect(state.status).toBe("OPEN");
    expect(state.activeSession?.openAtMs).toBe(instant(value));
    expect(state.calendarVersion).toBe("nyse-cash-2026-2028-as-of-2026-11-16");
    expect(state.checkedAt).toBe("2026-11-16T10:07:15.000Z");
    expect(state.sourceUrls).toContain(
      "https://www.nyse.com/trade/hours-calendars",
    );
  });

  it.each([
    [
      "NYSE",
      "2026-01-05T14:30:00.000Z",
      "nyse-cash-2026-2028-as-of-2026-11-16",
      ["https://www.nyse.com/trade/hours-calendars"],
    ],
    [
      "NASDAQ",
      "2026-01-05T14:30:00.000Z",
      "nasdaq-us-cash-2026-as-of-2026-11-16",
      ["https://www.nasdaq.com/market-activity/stock-market-holiday-schedule"],
    ],
    [
      "TSE",
      "2026-11-16T00:00:00.000Z",
      "jpx-cash-equities-2026-2027-as-of-2026-11-16",
      [
        "https://www.jpx.co.jp/english/corporate/about-jpx/calendar/index.html",
        "https://www.jpx.co.jp/english/equities/trading/domestic/01.html",
      ],
    ],
  ] as const)(
    "returns source version and checked time for %s",
    (exchange, value, version, sources) => {
      expect(marketCalendarStateAt(exchange, instant(value))).toMatchObject({
        calendarVersion: version,
        checkedAt: "2026-11-16T10:07:15.000Z",
        sourceUrls: sources,
      });
    },
  );

  it("uses exchange-specific holidays and early closes", () => {
    for (const exchange of ["NYSE", "NASDAQ"] as const) {
      expect(
        marketCalendarStateAt(exchange, instant("2026-11-26T16:00:00Z")),
      ).toMatchObject({ status: "CLOSED", reason: "EXCHANGE_HOLIDAY" });
      expect(
        marketCalendarStateAt(exchange, instant("2026-11-27T17:59:00Z")),
      ).toMatchObject({ status: "OPEN" });
      expect(
        marketCalendarStateAt(exchange, instant("2026-11-27T18:00:00Z")),
      ).toMatchObject({ status: "CLOSED", reason: "OUTSIDE_SESSION" });
    }
    expect(
      marketCalendarStateAt("NYSE", instant("2028-07-03T16:59:00Z")),
    ).toMatchObject({ status: "OPEN" });
    expect(
      marketCalendarStateAt("NYSE", instant("2028-07-03T17:00:00Z")),
    ).toMatchObject({ status: "CLOSED", reason: "OUTSIDE_SESSION" });
  });

  it("uses half-open TSE sessions and excludes lunch, holidays, and weekends", () => {
    expect(
      marketCalendarStateAt("TSE", instant("2026-11-16T00:00:00Z")),
    ).toMatchObject({ status: "OPEN" });
    expect(
      marketCalendarStateAt("TSE", instant("2026-11-16T02:30:00Z")),
    ).toMatchObject({ status: "CLOSED", reason: "OUTSIDE_SESSION" });
    expect(
      marketCalendarStateAt("TSE", instant("2026-11-16T03:29:00Z")),
    ).toMatchObject({ status: "CLOSED", reason: "OUTSIDE_SESSION" });
    expect(
      marketCalendarStateAt("TSE", instant("2026-11-16T03:30:00Z")),
    ).toMatchObject({ status: "OPEN" });
    expect(
      marketCalendarStateAt("TSE", instant("2026-11-16T06:30:00Z")),
    ).toMatchObject({ status: "CLOSED", reason: "OUTSIDE_SESSION" });
    expect(
      marketCalendarStateAt("TSE", instant("2026-09-22T01:00:00Z")),
    ).toMatchObject({ status: "CLOSED", reason: "EXCHANGE_HOLIDAY" });
    expect(
      marketCalendarStateAt("TSE", instant("2026-11-14T01:00:00Z")),
    ).toMatchObject({ status: "CLOSED", reason: "WEEKEND" });
  });

  it("fails closed outside each verified calendar coverage", () => {
    expect(
      marketCalendarStateAt("NASDAQ", instant("2027-01-04T15:00:00Z")),
    ).toMatchObject({
      status: "CALENDAR_UNAVAILABLE",
      reason: "UNSUPPORTED_YEAR",
      sourceUrls: [
        "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule",
      ],
    });
    expect(
      marketCalendarStateAt("NYSE", instant("2029-01-02T15:00:00Z")),
    ).toMatchObject({
      status: "CALENDAR_UNAVAILABLE",
      reason: "UNSUPPORTED_YEAR",
    });
  });

  it("applies and returns auditable temporary-closure provenance", () => {
    const instantMs = instant("2026-03-09T13:30:00Z");
    const override: MarketCalendarOverride = {
      exchange: "NYSE",
      date: marketDateAt(instantMs, "US"),
      reason: "Emergency exchange closure",
      sourceUrl: "https://www.nyse.com/trade/hours-calendars/notice",
      sourceVersion: "nyse-notice-2026-03-09",
      checkedAt: "2026-03-09T12:00:00Z",
    };

    expect(marketCalendarStateAt("NYSE", instantMs, [override])).toMatchObject({
      status: "CLOSED",
      reason: "TEMPORARY_CLOSURE",
      sourceUrls: [
        "https://www.nyse.com/trade/hours-calendars",
        override.sourceUrl,
      ],
      temporaryClosure: {
        reason: override.reason,
        sourceUrl: override.sourceUrl,
        sourceVersion: override.sourceVersion,
        checkedAt: override.checkedAt,
      },
    });
  });

  it("fails closed for malformed or conflicting temporary closures", () => {
    const instantMs = instant("2026-03-09T13:30:00Z");
    const base: MarketCalendarOverride = {
      exchange: "NYSE",
      date: marketDateAt(instantMs, "US"),
      reason: "Emergency exchange closure",
      sourceUrl: "https://www.nyse.com/trade/hours-calendars/notice",
      sourceVersion: "nyse-notice-2026-03-09",
      checkedAt: "2026-03-09T12:00:00Z",
    };
    const malformed = { ...base, date: "2026-02-30" } as MarketCalendarOverride;

    expect(marketCalendarStateAt("NYSE", instantMs, [malformed])).toMatchObject(
      {
        status: "CALENDAR_UNAVAILABLE",
        reason: "INVALID_OVERRIDE",
      },
    );
    expect(
      marketCalendarStateAt("NYSE", instantMs, [base, { ...base }]),
    ).toMatchObject({
      status: "CALENDAR_UNAVAILABLE",
      reason: "CONFLICTING_OVERRIDES",
    });
    expect(
      marketCalendarStateAt("NYSE", instantMs, [
        { ...base, sourceUrl: "https://example.com/closure" },
      ]),
    ).toMatchObject({
      status: "CALENDAR_UNAVAILABLE",
      reason: "INVALID_OVERRIDE",
    });
  });
});
