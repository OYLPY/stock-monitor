import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createTestDatabase } from "../../db/test-database.ts";
import { marketWatchSourceWatermarks } from "../../db/schema.ts";
import {
  appendMarketEventRevision,
  appendSourceRecord,
  createMarketEvent,
  registerSource,
} from "../evidence/repository.ts";
import { enqueueScheduledTask } from "../task-queue/queue.ts";
import {
  listNotificationDecisions,
  listNotifications,
  processMarketWatchAlerts,
  readMarketWatchSourceWatermarks,
} from "./alerts.ts";

const SOURCE_DETAILS = {
  "federalreserve.rss": {
    publisher: "Board of Governors of the Federal Reserve System",
    referenceUrl: "https://www.federalreserve.gov/feeds/feeds.htm",
  },
  "boj.rss": {
    publisher: "Bank of Japan",
    referenceUrl: "https://www.boj.or.jp/en/whatsnew/index.htm",
  },
} as const;

function taskRunId(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
) {
  return enqueueScheduledTask(database, {
    idempotencyKey: randomUUID(),
    runType: "MARKET_WATCH",
    input: {},
    timeZone: "Asia/Tokyo",
    scheduledLocalAt: "2026-11-19T09:00",
    timeoutMs: 60_000,
  }).task.id;
}

function registerTestSource(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
  sourceKey: keyof typeof SOURCE_DETAILS,
) {
  const details = SOURCE_DETAILS[sourceKey];
  return registerSource(database, {
    sourceKey,
    publisher: details.publisher,
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: details.referenceUrl,
    licenseUrl: null,
    licenseStatus: "VERIFIED",
    credentialRequirement: "NOT_REQUIRED",
  });
}

function record(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
  sourceId: string,
  recordKey: string,
  publishedAtMs: number,
) {
  return appendSourceRecord(database, {
    sourceId,
    recordKey,
    recordType: "DISCLOSURE",
    recordVersion: 1,
    supersedesRecordId: null,
    publishedAtMs,
    occurredAtMs: publishedAtMs,
    availableAtMs: publishedAtMs,
    rawTimeText: new Date(publishedAtMs).toISOString(),
    sourceTimeZone: "America/New_York",
    canonicalUrl: `https://www.federalreserve.gov/releases/${recordKey}.htm`,
    dataClass: "REAL",
    content: JSON.stringify({ recordKey, publishedAtMs }),
  });
}

function eventInput(
  sourceRecordId: string,
  publishedAtMs: number,
  importanceReason = "P11-03:POLICY_CHANGE: Official policy terms changed.",
  verificationLevel: "VERIFIED" | "PARTIAL" = "VERIFIED",
) {
  return {
    category: "FEDERAL_RESERVE_NOTICE",
    summary: "Federal Reserve policy decision",
    marketCode: "US" as const,
    instrument: null,
    occurredAtMs: publishedAtMs,
    publishedAtMs,
    importanceReason,
    dataClass: "REAL" as const,
    verificationLevel,
    verificationReason: "Official record and timestamp checked.",
    verificationRuleVersion: "official-event-v1",
    primarySourceRecordId: sourceRecordId,
    evidence: [{ sourceRecordId, relation: "SUPPORTS" as const }],
  };
}

async function preparedDatabase() {
  const fixture = await createTestDatabase();
  const source = registerTestSource(fixture.database, "federalreserve.rss");
  const nowMs = Date.UTC(2026, 10, 19, 15);
  fixture.database.orm
    .insert(marketWatchSourceWatermarks)
    .values({
      sourceKey: "federalreserve.rss",
      lastSuccessAtMs: BigInt(nowMs - 60_000),
    })
    .run();
  return { fixture, source, nowMs };
}

describe("market watch alerts", () => {
  it("baselines existing feed records on the first scan without notifying", async () => {
    const fixture = await createTestDatabase();
    const source = registerTestSource(fixture.database, "federalreserve.rss");
    const nowMs = Date.UTC(2026, 10, 19, 15);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const sourceRecord = record(
        fixture.database,
        source.id,
        "press-baseline",
        nowMs,
      );
      const event = createMarketEvent(
        fixture.database,
        eventInput(sourceRecord.id, nowMs),
      );
      const id = taskRunId(fixture.database);

      const result = processMarketWatchAlerts(fixture.database, {
        taskRunId: id,
        asOfMs: nowMs,
        openMarkets: ["US"],
        previousWatermarks: new Map(),
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
        ],
      });

      expect(result).toMatchObject({
        notificationCount: 0,
        baselineSourceKeys: ["federalreserve.rss"],
        decisions: [
          {
            eventId: event.id,
            outcome: "BASELINED",
            reasonCode: "FIRST_SCAN_BASELINE",
          },
        ],
      });
      expect(listNotifications(fixture.database)).toHaveLength(0);
      expect(listNotificationDecisions(fixture.database)).toHaveLength(1);
      expect(
        readMarketWatchSourceWatermarks(fixture.database).get(
          "federalreserve.rss",
        ),
      ).toBe(nowMs);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("notifies one verified cross-source event once and suppresses an unchanged revision", async () => {
    const { fixture, source, nowMs } = await preparedDatabase();
    const bojSource = registerTestSource(fixture.database, "boj.rss");
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const fedRecord = record(
        fixture.database,
        source.id,
        "press-policy",
        nowMs - 1_000,
      );
      const bojRecord = appendSourceRecord(fixture.database, {
        sourceId: bojSource.id,
        recordKey: "press-policy-jp",
        recordType: "DISCLOSURE",
        recordVersion: 1,
        supersedesRecordId: null,
        publishedAtMs: nowMs - 900,
        occurredAtMs: nowMs - 900,
        availableAtMs: nowMs - 900,
        rawTimeText: new Date(nowMs - 900).toISOString(),
        sourceTimeZone: "Asia/Tokyo",
        canonicalUrl: "https://www.boj.or.jp/en/press/press-policy.htm",
        dataClass: "REAL",
        content: "independent official confirmation",
      });
      const event = createMarketEvent(fixture.database, {
        ...eventInput(fedRecord.id, nowMs - 1_000),
        evidence: [
          { sourceRecordId: fedRecord.id, relation: "SUPPORTS" },
          { sourceRecordId: bojRecord.id, relation: "SUPPORTS" },
        ],
      });
      const id = taskRunId(fixture.database);
      const previousWatermarks = readMarketWatchSourceWatermarks(
        fixture.database,
      );

      const result = processMarketWatchAlerts(fixture.database, {
        taskRunId: id,
        asOfMs: nowMs,
        openMarkets: ["US", "JP"],
        previousWatermarks,
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
          { sourceKey: "boj.rss", status: "AVAILABLE" },
        ],
      });

      expect(result).toMatchObject({
        notificationCount: 1,
        allConfiguredFeedsAvailable: true,
        decisions: [
          {
            eventId: event.id,
            outcome: "SELECTED",
            reasonCode: "NEW_MAJOR_EVENT",
          },
        ],
      });
      expect(listNotifications(fixture.database)).toHaveLength(1);
      expect(listNotifications(fixture.database)[0]).toMatchObject({
        confidence_level: "HIGH",
        supporting_source_count: 2,
        sources: expect.arrayContaining([
          expect.objectContaining({
            source_key: "federalreserve.rss",
            source_record_id: fedRecord.id,
            license_status: "VERIFIED",
          }),
          expect.objectContaining({
            source_key: "boj.rss",
            source_record_id: bojRecord.id,
            license_status: "VERIFIED",
          }),
        ]),
      });
      expect(listNotificationDecisions(fixture.database)[0]).toMatchObject({
        open_market_priority: 1,
        priority_source_count: 2,
        priority_published_at_ms: nowMs - 1_000,
        sources: expect.arrayContaining([
          expect.objectContaining({ source_record_id: fedRecord.id }),
          expect.objectContaining({ source_record_id: bojRecord.id }),
        ]),
      });
      const retry = processMarketWatchAlerts(fixture.database, {
        taskRunId: id,
        asOfMs: nowMs,
        openMarkets: ["US", "JP"],
        previousWatermarks,
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
          { sourceKey: "boj.rss", status: "AVAILABLE" },
        ],
      });
      expect(retry.notificationCount).toBe(0);
      expect(retry.decisionCount).toBe(0);

      const replay = processMarketWatchAlerts(fixture.database, {
        taskRunId: taskRunId(fixture.database),
        asOfMs: nowMs + 1,
        openMarkets: ["US", "JP"],
        previousWatermarks,
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
          { sourceKey: "boj.rss", status: "AVAILABLE" },
        ],
      });
      expect(replay.notificationCount).toBe(0);
      expect(replay.decisions[0]).toMatchObject({
        outcome: "ALREADY_NOTIFIED",
        reasonCode: "ALREADY_NOTIFIED",
      });
      expect(listNotifications(fixture.database)).toHaveLength(1);
      expect(() =>
        fixture.database.client
          .prepare("UPDATE notification_decisions SET reason_code = 'changed'")
          .run(),
      ).toThrow("notification_decisions are append-only");
      expect(() =>
        fixture.database.client
          .prepare("DELETE FROM notification_decisions WHERE id = ?")
          .run(listNotificationDecisions(fixture.database)[0]!.id),
      ).toThrow("notification_decisions are append-only");
      expect(() =>
        fixture.database.client
          .prepare("UPDATE notifications SET created_at_ms = 0")
          .run(),
      ).toThrow("notifications are append-only");
      expect(() =>
        fixture.database.client
          .prepare("DELETE FROM notifications WHERE id = ?")
          .run(listNotifications(fixture.database)[0]!.id),
      ).toThrow("notifications are append-only");
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("does not notify headlines lacking verification or an explicit importance rule", async () => {
    const { fixture, source, nowMs } = await preparedDatabase();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const unverified = record(
        fixture.database,
        source.id,
        "press-unverified",
        nowMs - 2_000,
      );
      const unrated = record(
        fixture.database,
        source.id,
        "press-unrated",
        nowMs - 1_000,
      );
      const unverifiedEvent = createMarketEvent(
        fixture.database,
        eventInput(unverified.id, nowMs - 2_000, undefined, "PARTIAL"),
      );
      const unratedEvent = createMarketEvent(
        fixture.database,
        eventInput(
          unrated.id,
          nowMs - 1_000,
          "Official RSS headline only; event significance is not assessed.",
        ),
      );

      const result = processMarketWatchAlerts(fixture.database, {
        taskRunId: taskRunId(fixture.database),
        asOfMs: nowMs,
        openMarkets: ["US"],
        previousWatermarks: readMarketWatchSourceWatermarks(fixture.database),
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
        ],
      });

      expect(result.notificationCount).toBe(0);
      expect(result.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventId: unverifiedEvent.id,
            reasonCode: "EVENT_NOT_VERIFIED",
          }),
          expect.objectContaining({
            eventId: unratedEvent.id,
            reasonCode: "IMPORTANCE_NOT_RULED",
          }),
        ]),
      );
      expect(listNotifications(fixture.database)).toHaveLength(0);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("selects no more than three eligible events in a stable priority order", async () => {
    const { fixture, source, nowMs } = await preparedDatabase();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const events = Array.from({ length: 4 }, (_, index) => {
        const publishedAtMs = nowMs - 4_000 + index * 1_000;
        const sourceRecord = record(
          fixture.database,
          source.id,
          `press-${index}`,
          publishedAtMs,
        );
        return createMarketEvent(
          fixture.database,
          eventInput(sourceRecord.id, publishedAtMs),
        );
      });

      const result = processMarketWatchAlerts(fixture.database, {
        taskRunId: taskRunId(fixture.database),
        asOfMs: nowMs,
        openMarkets: ["US"],
        previousWatermarks: readMarketWatchSourceWatermarks(fixture.database),
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
        ],
      });

      expect(result.notificationCount).toBe(3);
      expect(
        result.decisions.filter(({ outcome }) => outcome === "SELECTED"),
      ).toHaveLength(3);
      expect(
        result.decisions.find(({ outcome }) => outcome === "DEFERRED_LIMIT"),
      ).toMatchObject({
        eventId: events[0]!.id,
        outcome: "DEFERRED_LIMIT",
        reasonCode: "LIMIT_EXCEEDED",
      });
      expect(
        result.decisions
          .filter(({ outcome }) => outcome === "SELECTED")
          .map(({ eventId }) => eventId),
      ).toEqual(expect.arrayContaining(events.slice(1).map(({ id }) => id)));
      expect(listNotifications(fixture.database)).toHaveLength(3);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("suppresses an unchanged major rule in a later event revision", async () => {
    const { fixture, source, nowMs } = await preparedDatabase();
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);

    try {
      const firstRecord = record(
        fixture.database,
        source.id,
        "press-revision-one",
        nowMs - 2_000,
      );
      const event = createMarketEvent(
        fixture.database,
        eventInput(firstRecord.id, nowMs - 2_000),
      );
      const initialResult = processMarketWatchAlerts(fixture.database, {
        taskRunId: taskRunId(fixture.database),
        asOfMs: nowMs,
        openMarkets: ["US"],
        previousWatermarks: readMarketWatchSourceWatermarks(fixture.database),
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
        ],
      });
      expect(initialResult.notificationCount).toBe(1);

      const revisionAtMs = nowMs + 10_000;
      dateNow.mockReturnValue(revisionAtMs);
      const revisedSourceRecord = record(
        fixture.database,
        source.id,
        "press-revision-two",
        revisionAtMs - 1_000,
      );
      appendMarketEventRevision(fixture.database, event.id, {
        ...eventInput(revisedSourceRecord.id, revisionAtMs - 1_000),
        importanceReason:
          "P11-03:POLICY_CHANGE: Same impact, added source detail.",
        evidence: [
          { sourceRecordId: firstRecord.id, relation: "SUPPORTS" },
          { sourceRecordId: revisedSourceRecord.id, relation: "SUPPORTS" },
        ],
      });

      const revisedResult = processMarketWatchAlerts(fixture.database, {
        taskRunId: taskRunId(fixture.database),
        asOfMs: revisionAtMs,
        openMarkets: ["US"],
        previousWatermarks: readMarketWatchSourceWatermarks(fixture.database),
        sourceStates: [
          { sourceKey: "federalreserve.rss", status: "AVAILABLE" },
        ],
      });
      expect(revisedResult).toMatchObject({
        notificationCount: 0,
        decisions: [
          { outcome: "SUPPRESSED", reasonCode: "NON_MAJOR_REVISION" },
        ],
      });
      expect(listNotifications(fixture.database)).toHaveLength(1);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });
});
