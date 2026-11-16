import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/db/test-database";
import { marketWatchDecisionAt } from "./market-watch";
import { enqueueScheduledTask, readTaskRun } from "../task-queue/queue.ts";
import { runWorker } from "../task-queue/worker.ts";

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
        marketDataFreshness: "UNKNOWN",
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

  it("runs through the registered Worker handler and persists calendar evidence", async () => {
    const fixture = await createTestDatabase();
    try {
      const { task } = enqueueScheduledTask(fixture.database, {
        idempotencyKey: randomUUID(),
        runType: "MARKET_WATCH",
        input: {},
        timeZone: "Asia/Tokyo",
        scheduledLocalAt: "2000-01-01T00:00",
        timeoutMs: 5_000,
      });

      await runWorker(fixture.database, {
        maxTasks: 1,
        heartbeatIntervalMs: 10,
        lockDurationMs: 1_000,
      });

      expect(readTaskRun(fixture.database, task.id)).toMatchObject({
        executionStatus: expect.stringMatching(/^(SKIPPED|BLOCKED_EXTERNAL)$/),
        resultCode: expect.stringMatching(
          /^(SKIPPED_CLOSED|SOURCE_UNAVAILABLE|CALENDAR_UNAVAILABLE)$/,
        ),
      });
      const event = fixture.database.client
        .prepare(
          `SELECT details_json FROM task_run_events
           WHERE task_run_id = ? AND event_type IN ('TASK_SKIPPED', 'TASK_BLOCKED_EXTERNAL')`,
        )
        .get(task.id) as { details_json: string } | undefined;

      expect(JSON.parse(event!.details_json)).toMatchObject({
        handler: {
          signalEvaluation: "NOT_RUN",
          calendars: expect.arrayContaining([
            expect.objectContaining({ calendarVersion: expect.any(String) }),
          ]),
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
