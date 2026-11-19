import { describe, expect, it, vi } from "vitest";

import { createTestDatabase } from "../../db/test-database";
import { listMarketEvents } from "../evidence/repository";
import { collectFederalReserveRss } from "../../providers/disclosures/collectors";
import { normalizeOfficialRssEvents } from "./normalizer";

type FeedItem = { title: string; guid: string; publishedAt: string };

function rss(items: FeedItem[]) {
  return `<rss><channel>${items
    .map(
      ({ title, guid, publishedAt }) =>
        `<item><title>${title}</title><link>https://www.federalreserve.gov/releases/${guid}.htm</link><guid>${guid}</guid><pubDate>${publishedAt}</pubDate></item>`,
    )
    .join("")}</channel></rss>`;
}

describe("official RSS event normalization", () => {
  it("rejects headlines without the publisher's source timezone", async () => {
    const fixture = await createTestDatabase();
    const nowMs = Date.UTC(2026, 10, 19, 18);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const fetcher: typeof fetch = async () =>
      new Response(
        rss([
          {
            title: "Federal Reserve policy update",
            guid: "press-1",
            publishedAt: "Thu, 19 Nov 2026 08:13:00 -0500",
          },
        ]),
        { status: 200 },
      );

    try {
      const collected = await collectFederalReserveRss(
        fixture.database,
        { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
        fetcher,
      );
      const record = collected.records[0]!;

      expect(
        normalizeOfficialRssEvents(
          fixture.database,
          [
            {
              ...record,
              record: { ...record.record, sourceTimeZone: null },
            },
          ],
          nowMs,
        ),
      ).toMatchObject({ rejected: 1 });
      expect(listMarketEvents(fixture.database)).toHaveLength(0);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("persists headlines idempotently, revises stable source IDs, and rejects future items", async () => {
    const fixture = await createTestDatabase();
    const baseNowMs = Date.UTC(2026, 10, 19, 18);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(baseNowMs);
    const items: FeedItem[] = [
      {
        title: "Federal Reserve policy update",
        guid: "press-1",
        publishedAt: "Thu, 19 Nov 2026 08:13:00 -0500",
      },
      {
        title: "Federal Reserve policy update",
        guid: "press-2",
        publishedAt: "Thu, 19 Nov 2026 08:13:00 -0500",
      },
    ];
    const fetcher: typeof fetch = async () =>
      new Response(rss(items), {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      });

    try {
      const collectAt = async (nowMs: number) => {
        dateNow.mockReturnValue(nowMs);
        const collected = await collectFederalReserveRss(
          fixture.database,
          { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
          fetcher,
        );
        expect(collected.status).toBe("AVAILABLE");
        return normalizeOfficialRssEvents(
          fixture.database,
          collected.records,
          nowMs,
        );
      };

      expect(await collectAt(baseNowMs)).toMatchObject({ created: 2 });
      const firstEvents = listMarketEvents(fixture.database);
      expect(firstEvents).toHaveLength(2);
      expect(firstEvents[0]?.revisions[0]).toMatchObject({
        category: "FEDERAL_RESERVE_NOTICE",
        summary: "Federal Reserve policy update",
        marketCode: "US",
        instrumentKey: null,
        occurredAtMs: null,
        publishedAtMs: BigInt(Date.parse("2026-11-19T13:13:00.000Z")),
        dataClass: "REAL",
        verificationLevel: "PARTIAL",
        importanceReason: expect.stringContaining("not assessed"),
        evidence: [
          {
            sourceKey: "federalreserve.rss",
            sourceTimeZone: "America/New_York",
            sourceLicenseStatus: "UNKNOWN",
            contentHashSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        ],
      });

      expect(await collectAt(baseNowMs + 61_000)).toMatchObject({
        unchanged: 2,
      });
      expect(listMarketEvents(fixture.database)).toHaveLength(2);
      expect(
        listMarketEvents(fixture.database).every(
          (event) => event.revisions.length === 1,
        ),
      ).toBe(true);

      items[0] = {
        ...items[0]!,
        title: "Federal Reserve revised policy update",
      };
      expect(await collectAt(baseNowMs + 122_000)).toMatchObject({
        revised: 1,
        unchanged: 1,
      });
      const revisedEvents = listMarketEvents(fixture.database);
      expect(revisedEvents).toHaveLength(2);
      expect(
        revisedEvents.find((event) =>
          event.revisions.some(({ summary }) =>
            summary.includes("revised policy"),
          ),
        )?.revisions,
      ).toHaveLength(2);

      items.push({
        title: "Future policy notice",
        guid: "press-future",
        publishedAt: new Date(
          baseNowMs + 122_000 + 60 * 60 * 1_000,
        ).toUTCString(),
      });
      expect(await collectAt(baseNowMs + 183_000)).toMatchObject({
        unchanged: 2,
        rejected: 1,
      });
      expect(listMarketEvents(fixture.database)).toHaveLength(2);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });
});
