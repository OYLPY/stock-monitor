import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "@/db";
import { sourceRecords, sources } from "@/db/schema";
import { createTestDatabase } from "@/db/test-database";
import { registerSource } from "@/features/evidence/repository";
import { collectReportSources } from "./task";

function blsObservations(offset: number) {
  return Array.from({ length: 14 }, (_, index) => {
    const month = index % 12;
    const year = index < 12 ? "2025" : "2026";
    const monthNumber = String(month + 1).padStart(2, "0");
    return {
      year,
      period: `M${monthNumber}`,
      periodName: `Month ${monthNumber}`,
      value: String(offset + index),
      footnotes: [],
    };
  });
}

function bojSeries(code: string, name: string, unit: string) {
  return {
    SERIES_CODE: code,
    NAME_OF_TIME_SERIES: name,
    UNIT: unit,
    FREQUENCY: "DAILY",
    CATEGORY: "Foreign Exchange",
    LAST_UPDATE: 20261118,
    VALUES: {
      SURVEY_DATES: [20261114, 20261115, 20261116, 20261117, 20261118],
      VALUES: [151.1, 152.2, 153.3, 154.4, 155.1],
    },
  };
}

function rssItems(title: string, domain: string) {
  return Array.from(
    { length: 5 },
    (_, index) =>
      `<item><title>${title} ${index + 1}</title><link>https://${domain}/2026/${index + 1}.htm</link><guid>${title}-${index + 1}</guid><pubDate>Thu, 19 Nov 2026 10:13:00 +0900</pubDate></item>`,
  ).join("");
}

describe("report source collection", () => {
  it("uses Tokyo's calendar year and month at the JST year boundary", async () => {
    const fixture = await createTestDatabase();
    const requests: { url: URL; body: BodyInit | null | undefined }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: new URL(String(input)), body: init?.body });
      throw new Error("offline_test_source");
    };

    try {
      await collectReportSources(
        fixture.database,
        Date.UTC(2025, 11, 31, 16),
        fetcher,
      );

      expect(
        JSON.parse(
          String(
            requests.find(({ url }) => url.hostname === "api.bls.gov")?.body,
          ),
        ),
      ).toMatchObject({ startyear: "2025", endyear: "2026" });
      const bojRequest = requests.find(
        ({ url }) => url.hostname === "www.stat-search.boj.or.jp",
      )?.url;
      expect(bojRequest?.searchParams.get("startDate")).toBe("202501");
      expect(bojRequest?.searchParams.get("endDate")).toBe("202601");
    } finally {
      await fixture.cleanup();
    }
  });

  it("persists official macro and central-bank evidence before report analysis", async () => {
    const fixture = await createTestDatabase();
    for (const source of [
      {
        sourceKey: "bls.api",
        publisher: "U.S. Bureau of Labor Statistics",
        referenceUrl: "https://www.bls.gov/developers/api_faqs.htm",
      },
      {
        sourceKey: "boj.timeseries",
        publisher: "Bank of Japan Time-Series Data Search",
        referenceUrl: "https://www.stat-search.boj.or.jp/index_en.html",
      },
    ]) {
      registerSource(fixture.database, {
        ...source,
        sourceType: "REGULATORY",
        authorityRole: "REGULATORY_PRIMARY",
        licenseUrl: null,
        licenseStatus: "UNKNOWN",
        credentialRequirement: "NOT_REQUIRED",
      });
    }
    const collectionTime = Date.UTC(2026, 10, 19, 2);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(collectionTime);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.bls.gov") {
        return Response.json({
          status: "REQUEST_SUCCEEDED",
          message: [],
          Results: {
            series: [
              {
                seriesID: "CUUR0000SA0",
                data: blsObservations(300),
              },
              {
                seriesID: "LNS14000000",
                data: blsObservations(3),
              },
            ],
          },
        });
      }
      if (url.searchParams.get("db") === "FM08") {
        return Response.json({
          STATUS: 200,
          MESSAGEID: "M1810001",
          MESSAGE: "Successfully completed",
          DATE: "2026-11-19T09:00:00.000+09:00",
          NEXTPOSITION: null,
          RESULTSET: [
            bojSeries(
              "FXERD04",
              "US.Dollar/Yen Spot Rate at 17:00",
              "Yen per U.S. Dollar",
            ),
            bojSeries(
              "FXERD05",
              "US.Dollar/Yen Central Rate",
              "Yen per U.S. Dollar",
            ),
          ],
        });
      }
      const boj = url.hostname === "www.boj.or.jp";
      const rss = boj
        ? rssItems("BOJ policy update", "www.boj.or.jp")
        : rssItems("Federal Reserve policy update", "www.federalreserve.gov");
      return new Response(`<rss><channel>${rss}</channel></rss>`, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    });

    try {
      const first = await collectReportSources(
        fixture.database,
        collectionTime,
        fetcher,
      );
      const recordsAfterFirst = fixture.database.orm
        .select()
        .from(sourceRecords)
        .all();
      expect(first.sourceReferences).toHaveLength(46);
      expect(
        fixture.database.orm
          .select()
          .from(sources)
          .all()
          .filter(({ sourceKey }) =>
            ["bls.api", "boj.timeseries"].includes(sourceKey),
          )
          .every(({ licenseStatus }) => licenseStatus === "UNKNOWN"),
      ).toBe(true);
      expect(
        first.sourceReferences.find((reference) =>
          reference.text[0]?.includes("CPI-U all items index"),
        ),
      ).toMatchObject({
        publisher: "U.S. Bureau of Labor Statistics",
        licenseStatus: "VERIFIED",
      });
      expect(
        first.sourceReferences.find(
          (reference) =>
            reference.publisher === "Bank of Japan Time-Series Data Search",
        ),
      ).toMatchObject({ licenseStatus: "VERIFIED" });
      expect(
        first.sourceReferences.filter((reference) =>
          reference.text[0]?.includes("CPI-U all items index"),
        ),
      ).toHaveLength(13);
      expect(
        first.sourceReferences.filter((reference) =>
          reference.text[0]?.includes("seasonally adjusted unemployment rate"),
        ),
      ).toHaveLength(13);
      expect(
        first.sourceReferences.filter(
          (reference) =>
            reference.publisher === "Bank of Japan Time-Series Data Search",
        ),
      ).toHaveLength(10);
      expect(
        first.sourceReferences.find((reference) =>
          reference.text[0]?.includes("US.Dollar/Yen Spot Rate"),
        ),
      ).toMatchObject({
        currencyCodes: ["JPY", "USD"],
        text: [expect.stringContaining("155.1")],
      });
      expect(
        first.sourceReferences.some(
          (reference) => reference.publisher === "Bank of Japan",
        ),
      ).toBe(true);
      expect(
        first.sourceReferences.some(
          (reference) =>
            reference.publisher ===
            "Board of Governors of the Federal Reserve System",
        ),
      ).toBe(true);
      expect(first.sourceCollectionStatuses).toEqual(
        expect.arrayContaining([
          expect.stringContaining("BLS v1: DELAYED"),
          expect.stringContaining("BOJ USD/JPY daily series: AVAILABLE"),
          expect.stringContaining("Federal Reserve RSS: AVAILABLE"),
          expect.stringContaining("BOJ RSS: AVAILABLE"),
        ]),
      );
      expect(recordsAfterFirst).toHaveLength(48);

      fixture.database.client.close();
      const reopened = await openDatabase(fixture.filePath);
      try {
        const persistedIds = new Set(
          reopened.orm
            .select({ id: sourceRecords.id })
            .from(sourceRecords)
            .all()
            .map(({ id }) => id),
        );
        expect(
          first.sourceReferences.every((reference) =>
            persistedIds.has(reference.id),
          ),
        ).toBe(true);

        dateNow.mockReturnValue(collectionTime + 24 * 60 * 60 * 1_000 + 1);
        const second = await collectReportSources(
          reopened,
          collectionTime + 24 * 60 * 60 * 1_000 + 1,
          fetcher,
        );
        expect(second.sourceReferences.map(({ id }) => id)).toEqual(
          first.sourceReferences.map(({ id }) => id),
        );
        expect(reopened.orm.select().from(sourceRecords).all()).toHaveLength(
          recordsAfterFirst.length,
        );
      } finally {
        reopened.client.close();
      }
    } finally {
      dateNow.mockRestore();
      await fixture.cleanup();
    }
  });

  it("downgrades unavailable official sources without writing evidence", async () => {
    const fixture = await createTestDatabase();
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("offline_test_source");
    });

    try {
      const result = await collectReportSources(
        fixture.database,
        Date.UTC(2026, 10, 19, 2),
        fetcher,
      );

      expect(result.sourceReferences).toEqual([]);
      expect(result.sourceCollectionStatuses).toEqual(
        expect.arrayContaining([
          expect.stringContaining("BLS v1: NOT_VERIFIED"),
          expect.stringContaining("BOJ USD/JPY daily series: NOT_VERIFIED"),
          expect.stringContaining("Federal Reserve RSS: NOT_VERIFIED"),
          expect.stringContaining("BOJ RSS: NOT_VERIFIED"),
        ]),
      );
      expect(fixture.database.orm.select().from(sourceRecords).all()).toEqual(
        [],
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
