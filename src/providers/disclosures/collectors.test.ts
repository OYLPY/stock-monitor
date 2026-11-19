import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvents, sourceRecords } from "../../db/schema";
import { createTestDatabase } from "../../db/test-database";
import {
  collectBlsSeries,
  collectBojRss,
  collectBojSeries,
  collectFederalReserveRss,
  recordDisclosureCitation,
  collectSecFilings,
} from "./index";

describe("official disclosure collectors", () => {
  it("collects SEC filing references without inventing a publication timestamp", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        filings: {
          recent: {
            accessionNumber: ["0000320193-26-000123"],
            filingDate: ["2026-11-16"],
            form: ["8-K"],
          },
        },
      }),
    );

    try {
      const result = await collectSecFilings(
        fixture.database,
        {
          cik: "320193",
          userAgent: "Quant Workbench contact@example.com",
        },
        fetcher,
      );

      expect(result.status).toBe("AVAILABLE");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.record).toMatchObject({
        recordType: "DISCLOSURE",
        dataClass: "REAL",
        publishedAtMs: null,
        availableAtMs: null,
        rawTimeText: "2026-11-16",
        canonicalUrl:
          "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.html",
      });
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        "https://data.sec.gov/submissions/CIK0000320193.json",
      );
      expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
        "User-Agent": "Quant Workbench contact@example.com",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects SEC collection without a valid contact User-Agent before a request", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>();

    try {
      const result = await collectSecFilings(
        fixture.database,
        { cik: "320193", userAgent: "Quant Workbench" },
        fetcher,
      );

      expect(result.status).toBe("BLOCKED_EXTERNAL");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("reserves SEC requests atomically within its documented rate window", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        filings: {
          recent: { accessionNumber: [], filingDate: [], form: [] },
        },
      }),
    );

    try {
      const results = await Promise.all(
        Array.from({ length: 11 }, () =>
          collectSecFilings(
            fixture.database,
            {
              cik: "320193",
              userAgent: "Quant Workbench contact@example.com",
            },
            fetcher,
          ),
        ),
      );

      expect(
        results.filter((result) => result.status === "BLOCKED_EXTERNAL"),
      ).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(10);
      expect(
        fixture.database.orm
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityType, "DISCLOSURE_SOURCE_REQUEST"),
              eq(auditEvents.entityId, "sec.edgar"),
            ),
          )
          .all(),
      ).toHaveLength(10);
    } finally {
      await fixture.cleanup();
    }
  });

  it("collects BOJ series values as historical observations, not release times", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        STATUS: 200,
        MESSAGEID: "M1810001",
        MESSAGE: "Successfully completed",
        DATE: "2026-11-16T09:00:00.000+09:00",
        PARAMETER: { FORMAT: "JSON", LANG: "EN", DB: "FF" },
        NEXTPOSITION: null,
        RESULTSET: [
          {
            SERIES_CODE: "FOF_FFAS110A100",
            NAME_OF_TIME_SERIES: "Assets/Currency and deposits",
            UNIT: "100 million yen",
            FREQUENCY: "QUARTERLY",
            CATEGORY: "Flow of Funds",
            LAST_UPDATE: 20261115,
            VALUES: { SURVEY_DATES: [202610], VALUES: [12345] },
          },
        ],
      }),
    );

    try {
      const result = await collectBojSeries(
        fixture.database,
        { databaseCode: "FF", seriesCodes: ["FOF_FFAS110A100"] },
        fetcher,
      );

      expect(result.status).toBe("AVAILABLE");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.record).toMatchObject({
        recordType: "OTHER",
        dataClass: "HISTORICAL",
        publishedAtMs: null,
        availableAtMs: null,
        rawTimeText: "202610",
      });
      expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL);
      expect(String(fetcher.mock.calls[0]?.[0])).toContain(
        "code=FOF_FFAS110A100",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed when the BOJ response is truncated", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        STATUS: 200,
        MESSAGE: "Successfully completed",
        DATE: "2026-11-16T09:00:00.000+09:00",
        NEXTPOSITION: 250,
        RESULTSET: [],
      }),
    );

    try {
      const result = await collectBojSeries(
        fixture.database,
        { databaseCode: "FF", seriesCodes: ["FOF_FFAS110A100"] },
        fetcher,
      );

      expect(result.status).toBe("NOT_VERIFIED");
      expect(result.records).toHaveLength(0);
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("collects BLS v1 observations as delayed historical references", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: "REQUEST_SUCCEEDED",
        responseTime: 20,
        message: [],
        Results: {
          series: [
            {
              seriesID: "CUUR0000SA0",
              data: [
                {
                  year: "2026",
                  period: "M10",
                  periodName: "October",
                  value: "324.5",
                  footnotes: [{}],
                },
                {
                  year: "2026",
                  period: "M09",
                  periodName: "September",
                  value: "-",
                  footnotes: [
                    {
                      code: "9",
                      text: "Data unavailable for this survey period.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    try {
      const result = await collectBlsSeries(
        fixture.database,
        { seriesIds: ["CUUR0000SA0"], startYear: "2020", endYear: "2026" },
        fetcher,
      );

      expect(result.status).toBe("DELAYED");
      expect(result.records).toHaveLength(1);
      expect(result.reason).toContain("excluded 1 unavailable values");
      expect(result.records[0]?.record).toMatchObject({
        recordType: "OTHER",
        dataClass: "HISTORICAL",
        publishedAtMs: null,
        occurredAtMs: null,
        availableAtMs: null,
        rawTimeText: "2026 M10 (October)",
      });
      expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({
          seriesid: ["CUUR0000SA0"],
          startyear: "2020",
          endyear: "2026",
        }),
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("enforces BLS v1's unregistered daily request quota persistently", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: "REQUEST_SUCCEEDED",
        message: [],
        Results: { series: [{ seriesID: "CUUR0000SA0", data: [] }] },
      }),
    );

    try {
      const input = { seriesIds: ["CUUR0000SA0"] };
      for (let index = 0; index < 25; index += 1) {
        expect(
          (await collectBlsSeries(fixture.database, input, fetcher)).status,
        ).toBe("DELAYED");
      }
      expect(
        (await collectBlsSeries(fixture.database, input, fetcher)).status,
      ).toBe("BLOCKED_EXTERNAL");
      expect(fetcher).toHaveBeenCalledTimes(25);
    } finally {
      await fixture.cleanup();
    }
  });

  it("limits BOJ collection to one request per rolling second", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        STATUS: 200,
        MESSAGE: "Successfully completed",
        DATE: "2026-11-16T09:00:00.000+09:00",
        NEXTPOSITION: null,
        RESULTSET: [
          {
            SERIES_CODE: "series",
            NAME_OF_TIME_SERIES: "Series",
            UNIT: "index",
            FREQUENCY: "MONTHLY",
            CATEGORY: "Category",
            VALUES: { SURVEY_DATES: [], VALUES: [] },
          },
        ],
      }),
    );
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    try {
      const input = { databaseCode: "DB", seriesCodes: ["series"] };
      expect(
        (await collectBojSeries(fixture.database, input, fetcher)).status,
      ).toBe("AVAILABLE");
      expect(
        (await collectBojSeries(fixture.database, input, fetcher)).status,
      ).toBe("BLOCKED_EXTERNAL");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      await fixture.cleanup();
    }
  });

  it("does not persist blank or not-yet-complete BOJ daily observations", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        STATUS: 200,
        MESSAGE: "Successfully completed",
        DATE: "2026-11-19T11:00:00.000+09:00",
        NEXTPOSITION: null,
        RESULTSET: [
          {
            SERIES_CODE: "FXERD04",
            NAME_OF_TIME_SERIES: "U.S.Dollar/Yen Spot Rate at 17:00",
            UNIT: "Yen per U.S. Dollar",
            FREQUENCY: "DAILY",
            CATEGORY: "Foreign Exchange",
            VALUES: {
              SURVEY_DATES: [20261118, 20261119, 20261120, 20261121],
              VALUES: [154.4, 155.1, 156.2, null],
            },
          },
        ],
      }),
    );
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.UTC(2026, 10, 19, 2));

    try {
      const result = await collectBojSeries(
        fixture.database,
        { databaseCode: "FM08", seriesCodes: ["FXERD04"] },
        fetcher,
      );

      expect(result.status).toBe("AVAILABLE");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.record).toMatchObject({
        rawTimeText: "20261118",
        sourceTimeZone: "Asia/Tokyo",
      });
      expect(result.records[0]?.title).toContain("154.4");
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(1);
    } finally {
      now.mockRestore();
      await fixture.cleanup();
    }
  });

  it("limits Federal Reserve RSS polling to once per rolling minute", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title></channel></rss>`,
          { status: 200 },
        ),
    );
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    try {
      const input = {
        feedUrl: "https://www.federalreserve.gov/feeds/example.xml",
      };
      expect(
        (await collectFederalReserveRss(fixture.database, input, fetcher))
          .status,
      ).toBe("AVAILABLE");
      expect(
        (await collectFederalReserveRss(fixture.database, input, fetcher))
          .status,
      ).toBe("BLOCKED_EXTERNAL");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      await fixture.cleanup();
    }
  });

  it("stores changed source content as a superseding record version", async () => {
    const fixture = await createTestDatabase();
    let value = "324.5";
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: "REQUEST_SUCCEEDED",
        message: [],
        Results: {
          series: [
            {
              seriesID: "CUUR0000SA0",
              data: [
                {
                  year: "2026",
                  period: "M10",
                  periodName: "October",
                  value,
                  footnotes: [],
                },
              ],
            },
          ],
        },
      }),
    );

    try {
      const first = await collectBlsSeries(
        fixture.database,
        { seriesIds: ["CUUR0000SA0"] },
        fetcher,
      );
      value = "324.6";
      const revised = await collectBlsSeries(
        fixture.database,
        { seriesIds: ["CUUR0000SA0"] },
        fetcher,
      );

      const records = fixture.database.orm.select().from(sourceRecords).all();
      expect(first.records[0]?.record.recordVersion).toBe(1);
      expect(revised.records[0]?.record.recordVersion).toBe(2);
      expect(revised.records[0]?.record.supersedesRecordId).toBe(
        first.records[0]?.record.id,
      );
      expect(records).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("accepts only RSS feeds and citations hosted by the Federal Reserve", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Rate &amp; policy</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261116a.htm</link><guid>press-1</guid><pubDate>Mon, 16 Nov 2026 14:00:00 GMT</pubDate></item><item><title>Rate &amp; policy</title><link>https://www.federalreserve.gov/newsevents/press/monetary20261116a.htm</link><guid>press-1</guid><pubDate>Mon, 16 Nov 2026 14:00:00 GMT</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/rss+xml" } },
        ),
    );

    try {
      const result = await collectFederalReserveRss(
        fixture.database,
        { feedUrl: "https://www.federalreserve.gov/feeds/example.xml" },
        fetcher,
      );

      expect(result.status).toBe("AVAILABLE");
      expect(result.records).toHaveLength(2);
      expect(result.records[1]?.duplicate).toBe(true);
      expect(result.records[0]?.record).toMatchObject({
        dataClass: "REAL",
        publishedAtMs: BigInt(Date.parse("Mon, 16 Nov 2026 14:00:00 GMT")),
        rawTimeText: "Mon, 16 Nov 2026 14:00:00 GMT",
        sourceTimeZone: "America/New_York",
      });
      expect(result.records[0]?.record.canonicalUrl).toBe(
        "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261116a.htm",
      );
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(1);
      expect(result.records[0]?.record.contentHashSha256).not.toBe("");
    } finally {
      await fixture.cleanup();
    }
  });

  it("versions a previously stored feed record when its source timezone is recovered", async () => {
    const fixture = await createTestDatabase();
    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-11-19T18:00:00Z"));
    const fetcher: typeof fetch = async () =>
      new Response(
        `<rss><channel><item><title>Policy notice</title><link>https://www.federalreserve.gov/releases/press-1.htm</link><guid>press-1</guid><pubDate>Thu, 19 Nov 2026 08:13:00 -0500</pubDate></item></channel></rss>`,
        { status: 200 },
      );

    try {
      const input = {
        feedUrl: "https://www.federalreserve.gov/feeds/example.xml",
      };
      const rawTimeText = "Thu, 19 Nov 2026 08:13:00 -0500";
      const previous = recordDisclosureCitation(fixture.database, {
        provider: "federalreserve.rss",
        externalId: "press-1",
        publisher: "Federal Reserve",
        referenceUrl: "https://www.federalreserve.gov/releases/press-1.htm",
        title: "Policy notice",
        contentFingerprint: createHash("sha256")
          .update(
            JSON.stringify({
              guid: "press-1",
              title: "Policy notice",
              rawTimeText,
            }),
          )
          .digest("hex"),
        publishedAtMs: Date.parse(rawTimeText),
        rawTimeText,
        sourceTimeZone: null,
        dataClass: "REAL",
      }).record;

      const refreshed = await collectFederalReserveRss(
        fixture.database,
        input,
        fetcher,
      );

      expect(refreshed.records[0]?.record).toMatchObject({
        sourceTimeZone: "America/New_York",
        recordVersion: 2,
        supersedesRecordId: previous.id,
      });
      expect(refreshed.records[0]?.record.id).not.toBe(previous.id);
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("collects the official BOJ RSS feed and upgrades its same-host HTTP links", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          `<rss><channel><item><title>Statement by the Governor</title><link>http://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026.htm</link><guid>boj-policy-2026</guid><pubDate>Thu, 19 Nov 2026 10:13:00 +0900</pubDate></item></channel></rss>`,
          { status: 200, headers: { "Content-Type": "application/xml" } },
        ),
    );

    try {
      const result = await collectBojRss(
        fixture.database,
        { feedUrl: "https://www.boj.or.jp/en/rss/whatsnew.xml" },
        fetcher,
      );
      const rateLimited = await collectBojRss(
        fixture.database,
        { feedUrl: "https://www.boj.or.jp/en/rss/whatsnew.xml" },
        fetcher,
      );

      expect(result.status).toBe("AVAILABLE");
      expect(result.records[0]).toMatchObject({
        provider: "boj.rss",
        title: "Statement by the Governor",
      });
      expect(result.records[0]?.record.canonicalUrl).toBe(
        "https://www.boj.or.jp/en/mopo/mpmdeci/mpr_2026.htm",
      );
      expect(result.records[0]?.record.sourceTimeZone).toBe("Asia/Tokyo");
      expect(rateLimited.status).toBe("BLOCKED_EXTERNAL");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a feed item that links outside the Federal Reserve domain", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          `<rss><channel><item><title>Untrusted</title><link>https://federalreserve.gov.evil.example/item</link><guid>item-1</guid></item></channel></rss>`,
          { status: 200 },
        ),
    );

    try {
      const result = await collectFederalReserveRss(
        fixture.database,
        { feedUrl: "https://www.federalreserve.gov/feeds/example.xml" },
        fetcher,
      );

      expect(result.status).toBe("NOT_VERIFIED");
      expect(result.records).toHaveLength(0);
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects oversized responses before parsing or persistence", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array(4_000_001), { status: 200 }),
    );

    try {
      const result = await collectFederalReserveRss(
        fixture.database,
        { feedUrl: "https://www.federalreserve.gov/feeds/example.xml" },
        fetcher,
      );

      expect(result.status).toBe("NOT_VERIFIED");
      expect(result.records).toHaveLength(0);
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects unsafe feeds, DTD input, HTTP failures, and invalid provider payloads", async () => {
    const fixture = await createTestDatabase();
    const unusedFetcher = vi.fn<typeof fetch>();
    const dtdFetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          `<!DOCTYPE rss [<!ENTITY x "bad">]><rss><channel/></rss>`,
          { status: 200 },
        ),
    );
    const httpFailureFetcher = vi.fn<typeof fetch>(
      async () => new Response("unavailable", { status: 503 }),
    );
    const invalidJsonFetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ filings: { recent: { accessionNumber: [], form: [] } } }),
    );

    try {
      const unsafeFeed = await collectFederalReserveRss(
        fixture.database,
        { feedUrl: "https://federalreserve.gov.evil.example/feed.xml" },
        unusedFetcher,
      );
      const dtdFeed = await collectFederalReserveRss(
        fixture.database,
        { feedUrl: "https://www.federalreserve.gov/feeds/example.xml" },
        dtdFetcher,
      );
      const httpFailure = await collectBojSeries(
        fixture.database,
        { databaseCode: "FF", seriesCodes: ["FOF_FFAS110A100"] },
        httpFailureFetcher,
      );
      const invalidSec = await collectSecFilings(
        fixture.database,
        { cik: "320193", userAgent: "Quant Workbench contact@example.com" },
        invalidJsonFetcher,
      );

      expect(unsafeFeed.status).toBe("BLOCKED_EXTERNAL");
      expect(unusedFetcher).not.toHaveBeenCalled();
      expect(dtdFeed.status).toBe("NOT_VERIFIED");
      expect(httpFailure.status).toBe("NOT_VERIFIED");
      expect(httpFailure.reason).toContain("HTTP 503");
      expect(invalidSec.status).toBe("NOT_VERIFIED");
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
