import { describe, expect, it } from "vitest";
import { sourceRecords, sources } from "../../db/schema";
import { createTestDatabase } from "../../db/test-database";
import {
  disclosureSourcePolicies,
  getDisclosureSourceState,
  normalizeDisclosureCitation,
  recordDisclosureCitation,
} from "./index";
import type { DisclosureProvider } from "./index";

describe("disclosure citations", () => {
  it("normalizes official references without inventing publication or availability times", () => {
    const citation = normalizeDisclosureCitation({
      provider: "sec.edgar",
      externalId: "0000320193-26-000123",
      referenceUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/index.htm?source=feed#filing",
      title: "8-K filing",
      rawTimeText: "2026-11-16T16:05:00-05:00",
    });

    expect(citation.source.sourceKey).toBe("sec.edgar");
    expect(citation.record).toMatchObject({
      recordKey: "disclosure:0000320193-26-000123",
      recordType: "DISCLOSURE",
      publishedAtMs: null,
      occurredAtMs: null,
      availableAtMs: null,
      rawTimeText: "2026-11-16T16:05:00-05:00",
      sourceTimeZone: "America/New_York",
      canonicalUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/index.htm",
      dataClass: "NOT_VERIFIED",
    });
    expect(citation.record.content).toBe(
      JSON.stringify({
        provider: "sec.edgar",
        externalId: "0000320193-26-000123",
        title: "8-K filing",
        publishedAtMs: null,
        occurredAtMs: null,
        availableAtMs: null,
        rawTimeText: "2026-11-16T16:05:00-05:00",
        sourceTimeZone: "America/New_York",
      }),
    );
  });

  it("stores one record when the same provider ID arrives through multiple URLs", async () => {
    const fixture = await createTestDatabase();
    try {
      const first = recordDisclosureCitation(fixture.database, {
        provider: "sec.edgar",
        externalId: "0000320193-26-000123",
        referenceUrl:
          "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/index.htm",
        title: "8-K filing",
        rawTimeText: "2026-11-16T16:05:00-05:00",
      });
      const duplicate = recordDisclosureCitation(fixture.database, {
        provider: "sec.edgar",
        externalId: "0000320193-26-000123",
        referenceUrl:
          "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/filing.htm",
        title: "8-K filing",
        rawTimeText: "2026-11-16T16:05:00-05:00",
      });

      expect(first.duplicate).toBe(false);
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.record.id).toBe(first.record.id);
      expect(fixture.database.orm.select().from(sources).all()).toHaveLength(1);
      expect(
        fixture.database.orm.select().from(sourceRecords).all(),
      ).toHaveLength(1);
      expect(() =>
        recordDisclosureCitation(fixture.database, {
          provider: "sec.edgar",
          externalId: "0000320193-26-000123",
          referenceUrl:
            "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/index.htm",
          title: "Changed title for same filing",
          rawTimeText: "2026-11-16T16:05:00-05:00",
        }),
      ).toThrow("disclosure_identity_content_conflict");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects non-official hosts and marks credentialed or paid sources", () => {
    expect(() =>
      normalizeDisclosureCitation({
        provider: "sec.edgar",
        externalId: "filing-1",
        referenceUrl: "https://sec.gov.evil.example/filing/1",
        title: "Untrusted filing",
      }),
    ).toThrow("untrusted_disclosure_reference_host");

    expect(disclosureSourcePolicies["edinet.v2"].accessMode).toBe(
      "API_KEY_REQUIRED",
    );
    expect(disclosureSourcePolicies["bea.api"].accessMode).toBe(
      "API_KEY_REQUIRED",
    );
    expect(disclosureSourcePolicies["tdnet.api"].accessMode).toBe(
      "PAID_API_DISABLED",
    );
    expect(disclosureSourcePolicies["issuer.ir"].accessMode).toBe(
      "MANUAL_REFERENCE",
    );
    expect(getDisclosureSourceState("bea.api")).toEqual({
      status: "BLOCKED_EXTERNAL",
      reason: "API credentials are required and are not configured.",
    });
    expect(getDisclosureSourceState("bea.api", true).status).toBe(
      "NOT_VERIFIED",
    );
    expect(getDisclosureSourceState("edinet.v2").status).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(getDisclosureSourceState("tdnet.api").status).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(getDisclosureSourceState("issuer.ir").status).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(getDisclosureSourceState("sec.edgar").status).toBe("NOT_VERIFIED");
  });

  it("accepts all official source families through the shared citation adapter", () => {
    const references: Array<[DisclosureProvider, string, string?]> = [
      ["sec.edgar", "https://www.sec.gov/filing"],
      ["edinet.v2", "https://disclosure2dl.edinet-fsa.go.jp/document"],
      ["tdnet.api", "https://www.jpx.co.jp/disclosure"],
      ["boj.timeseries", "https://www.stat-search.boj.or.jp/series"],
      [
        "federalreserve.rss",
        "https://www.federalreserve.gov/feeds/example.xml",
      ],
      ["bls.api", "https://www.bls.gov/data"],
      ["bea.api", "https://apps.bea.gov/data"],
      ["issuer.ir", "https://investor.example.com/ir", "Example Issuer"],
    ];

    for (const [provider, referenceUrl, publisher] of references) {
      const citation = normalizeDisclosureCitation({
        provider,
        externalId: "record-1",
        referenceUrl,
        title: "Official source record",
        ...(publisher ? { publisher } : {}),
      });

      expect(citation.source.sourceKey).toBe(
        provider === "issuer.ir" ? "issuer.ir.investor.example.com" : provider,
      );
    }
  });

  it("preserves an explicitly unknown source timezone", () => {
    const citation = normalizeDisclosureCitation({
      provider: "boj.timeseries",
      externalId: "FXERD02",
      referenceUrl: "https://www.stat-search.boj.or.jp/index_en.html",
      title: "Exchange rate series",
      sourceTimeZone: null,
    });

    expect(citation.record.sourceTimeZone).toBeNull();
  });
});
