import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { marketWatchSourceWatermarks } from "@/db/schema";
import { createTestDatabase } from "@/db/test-database";
import { enqueueScheduledTask } from "@/features/task-queue/queue";
import { marketWatchDecisionAt, runMarketWatchTask } from "./market-watch";

function instant(value: string) {
  return Date.parse(value);
}

describe("market watch session gate", () => {
  it("skips weekends and the TSE lunch window when US markets are closed", () => {
    expect(
      marketWatchDecisionAt(instant("2026-11-14T01:00:00Z")),
    ).toMatchObject({
      executionStatus: "SKIPPED",
      resultCode: "SKIPPED_CLOSED",
      details: {
        openExchanges: [],
        signalEvaluation: "NOT_RUN",
        calendars: expect.arrayContaining([
          expect.objectContaining({ status: "CLOSED", reason: "WEEKEND" }),
        ]),
      },
    });

    expect(
      marketWatchDecisionAt(instant("2026-11-16T02:45:00Z")),
    ).toMatchObject({
      executionStatus: "SKIPPED",
      resultCode: "SKIPPED_CLOSED",
      details: { openExchanges: [] },
    });

    expect(
      marketWatchDecisionAt(instant("2026-11-26T16:00:00Z")),
    ).toMatchObject({
      executionStatus: "SKIPPED",
      resultCode: "SKIPPED_CLOSED",
      details: {
        calendars: expect.arrayContaining([
          expect.objectContaining({
            exchange: "NYSE",
            reason: "EXCHANGE_HOLIDAY",
          }),
        ]),
      },
    });
  });

  it("uses the exchange-local DST session and blocks signal evaluation without a source", () => {
    expect(
      marketWatchDecisionAt(instant("2026-11-02T14:30:00Z")),
    ).toMatchObject({
      executionStatus: "BLOCKED_EXTERNAL",
      resultCode: "SOURCE_UNAVAILABLE",
      details: {
        openExchanges: ["NYSE", "NASDAQ"],
        signalEvaluation: "NOT_RUN",
        marketDataFreshness: "NOT_VERIFIED",
        calendars: expect.arrayContaining([
          expect.objectContaining({
            exchange: "NYSE",
            timeZone: "America/New_York",
            status: "OPEN",
            activeSession: {
              openTime: "09:30",
              closeTime: "16:00",
              openAtMs: instant("2026-11-02T14:30:00Z"),
              closeAtMs: instant("2026-11-02T21:00:00Z"),
            },
          }),
        ]),
      },
    });
  });

  it("uses early closes and fails closed outside verified calendar coverage", () => {
    expect(
      marketWatchDecisionAt(instant("2026-11-27T17:59:00Z")),
    ).toMatchObject({
      resultCode: "SOURCE_UNAVAILABLE",
      details: { openExchanges: ["NYSE", "NASDAQ"] },
    });
    expect(
      marketWatchDecisionAt(instant("2026-11-27T18:00:00Z")),
    ).toMatchObject({
      executionStatus: "SKIPPED",
      resultCode: "SKIPPED_CLOSED",
    });
    expect(
      marketWatchDecisionAt(instant("2029-01-02T15:00:00Z")),
    ).toMatchObject({
      executionStatus: "BLOCKED_EXTERNAL",
      resultCode: "CALENDAR_UNAVAILABLE",
    });
  });

  it("collects official feeds only during an open session and preserves the quote blocker", async () => {
    const fixture = await createTestDatabase();
    const scanAtMs = instant("2026-11-02T14:30:00Z");
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("offline_test_source");
    });
    try {
      const result = await runMarketWatchTask(
        fixture.database,
        { taskRunId: randomUUID(), signal: new AbortController().signal },
        fetcher,
        scanAtMs,
      );

      expect(result).toMatchObject({
        executionStatus: "BLOCKED_EXTERNAL",
        resultCode: "SOURCE_UNAVAILABLE",
        details: {
          openExchanges: ["NYSE", "NASDAQ"],
          signalEvaluation: "NOT_RUN",
          marketDataFreshness: "NOT_VERIFIED",
          rssSources: {
            federalReserve: { status: "NOT_VERIFIED" },
            bankOfJapan: { status: "NOT_VERIFIED" },
          },
          alerts: {
            notificationCount: 0,
            allConfiguredFeedsAvailable: false,
          },
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(
        fixture.database.orm.select().from(marketWatchSourceWatermarks).all(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("stores fetched headlines as partial evidence without creating live alerts", async () => {
    const fixture = await createTestDatabase();
    const scanAtMs = instant("2026-11-02T14:30:00Z");
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(scanAtMs);
    fixture.database.orm
      .insert(marketWatchSourceWatermarks)
      .values([
        {
          sourceKey: "federalreserve.rss",
          lastSuccessAtMs: BigInt(scanAtMs - 60_000),
        },
        {
          sourceKey: "boj.rss",
          lastSuccessAtMs: BigInt(scanAtMs - 60_000),
        },
      ])
      .run();
    const taskRunId = enqueueScheduledTask(fixture.database, {
      idempotencyKey: randomUUID(),
      runType: "MARKET_WATCH",
      input: {},
      timeZone: "America/New_York",
      scheduledLocalAt: "2026-11-02T09:30:00",
      timeoutMs: 60_000,
    }).task.id;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const isFed = String(input).includes("federalreserve.gov");
      const hostname = isFed ? "www.federalreserve.gov" : "www.boj.or.jp";
      const path = isFed
        ? "/newsevents/pressreleases/policy.htm"
        : "/en/whatsnew/2026/notice.htm";
      const title = isFed ? "Policy announcement" : "Policy notice";
      const publishedAt = "Mon, 02 Nov 2026 14:29:30 GMT";
      return new Response(
        `<rss><channel><item><title>${title}</title><link>https://${hostname}${path}</link><guid>${isFed ? "fed" : "boj"}-notice-1</guid><pubDate>${publishedAt}</pubDate></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } },
      );
    });

    try {
      const result = await runMarketWatchTask(
        fixture.database,
        { taskRunId, signal: new AbortController().signal },
        fetcher,
        scanAtMs,
      );

      expect(result).toMatchObject({
        executionStatus: "BLOCKED_EXTERNAL",
        resultCode: "SOURCE_UNAVAILABLE",
        details: {
          eventNormalization: { created: 2, rejected: 0 },
          alerts: {
            notificationCount: 0,
            allConfiguredFeedsAvailable: true,
            decisions: expect.arrayContaining([
              expect.objectContaining({ reasonCode: "EVENT_NOT_VERIFIED" }),
            ]),
          },
          rssSources: {
            federalReserve: { status: "AVAILABLE", records: 1 },
            bankOfJapan: { status: "AVAILABLE", records: 1 },
          },
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(
        fixture.database.client
          .prepare("SELECT COUNT(*) FROM notifications")
          .pluck()
          .get(),
      ).toBe(BigInt(0));
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("does not request official feeds while every target exchange is closed", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>();
    try {
      const result = await runMarketWatchTask(
        fixture.database,
        { taskRunId: randomUUID(), signal: new AbortController().signal },
        fetcher,
        instant("2026-11-14T01:00:00Z"),
      );

      expect(result).toMatchObject({
        executionStatus: "SKIPPED",
        resultCode: "SKIPPED_CLOSED",
      });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});
