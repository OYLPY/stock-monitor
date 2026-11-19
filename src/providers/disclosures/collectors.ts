import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../../db";
import { withTransaction } from "../../db";
import { auditEvents, sourceRecords, sources } from "../../db/schema";
import { recordAuditEvent } from "../../features/evidence/repository";
import { normalizeDisclosureCitation, recordDisclosureCitation } from "./index";
import type { DisclosureCitationInput, DisclosureProvider } from "./index";

const MAX_RESPONSE_BYTES = 4_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SEC_REQUEST_WINDOW_MS = 1_000;
const SEC_REQUEST_LIMIT = 10;
const BLS_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1_000;
const BLS_REQUEST_LIMIT = 25;
const BOJ_REQUEST_WINDOW_MS = 1_000;
const BOJ_REQUEST_LIMIT = 1;
const BOJ_RSS_REQUEST_WINDOW_MS = 60_000;
const BOJ_RSS_REQUEST_LIMIT = 1;
const FED_REQUEST_WINDOW_MS = 60_000;
const FED_REQUEST_LIMIT = 1;
const secEndpoint = "https://data.sec.gov/submissions/";
const bojEndpoint = "https://www.stat-search.boj.or.jp/api/v1/getDataCode";
const blsEndpoint = "https://api.bls.gov/publicAPI/v1/timeseries/data/";

const secInputSchema = z.strictObject({
  cik: z
    .string()
    .trim()
    .regex(/^\d{1,10}$/)
    .refine((value) => BigInt(value) > 0),
  userAgent: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^\r\n]+\s+[^\s@]+@[^\s@]+\.[^\s@]+$/),
});

const secResponseSchema = z.object({
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string().regex(/^\d{10}-\d{2}-\d{6}$/)),
      filingDate: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      form: z.array(z.string().trim().min(1).max(32)),
    }),
  }),
});

const bojInputSchema = z.strictObject({
  databaseCode: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/),
  seriesCodes: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9_-]+$/),
    )
    .min(1)
    .max(250)
    .refine((codes) => new Set(codes).size === codes.length),
  startDate: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

const bojResponseSchema = z.object({
  STATUS: z.number(),
  MESSAGE: z.string(),
  DATE: z.string(),
  NEXTPOSITION: z.number().nullable().optional(),
  RESULTSET: z.array(
    z.object({
      SERIES_CODE: z.string().min(1).max(64),
      NAME_OF_TIME_SERIES: z.string().max(500),
      UNIT: z.string().max(100),
      FREQUENCY: z.string().max(32),
      CATEGORY: z.string().max(200),
      LAST_UPDATE: z.union([z.number(), z.string()]).nullable().optional(),
      VALUES: z.object({
        SURVEY_DATES: z.array(z.union([z.number(), z.string().min(1).max(32)])),
        VALUES: z.array(z.union([z.number(), z.string().max(100), z.null()])),
      }),
    }),
  ),
});

const blsInputSchema = z
  .strictObject({
    seriesIds: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/),
      )
      .min(1)
      .max(25)
      .refine((seriesIds) => new Set(seriesIds).size === seriesIds.length),
    startYear: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    endYear: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  })
  .superRefine((input, context) => {
    if (Boolean(input.startYear) !== Boolean(input.endYear)) {
      context.addIssue({
        code: "custom",
        message: "both_year_bounds_required",
      });
      return;
    }
    if (
      input.startYear &&
      input.endYear &&
      (Number(input.endYear) < Number(input.startYear) ||
        Number(input.endYear) - Number(input.startYear) > 9)
    ) {
      context.addIssue({
        code: "custom",
        message: "bls_v1_year_range_exceeded",
      });
    }
  });

const blsResponseSchema = z.object({
  status: z.string(),
  message: z.array(z.string()),
  Results: z.object({
    series: z.array(
      z.object({
        seriesID: z.string().min(1).max(64),
        data: z.array(
          z.object({
            year: z.string().regex(/^\d{4}$/),
            period: z.string().min(1).max(16),
            periodName: z.string().trim().min(1).max(64),
            value: z.string().max(100),
            footnotes: z.array(
              z.object({
                code: z.string().max(16).optional(),
                text: z.string().max(500).optional(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

const feedInputSchema = z.strictObject({ feedUrl: z.string().url().max(500) });
const feedTextSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({ "#text": z.string().trim().min(1).max(500) }),
]);
const feedItemSchema = z.object({
  title: feedTextSchema,
  link: feedTextSchema,
  guid: feedTextSchema.optional(),
  pubDate: feedTextSchema.optional(),
});
const rssResponseSchema = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([feedItemSchema, z.array(feedItemSchema)]).optional(),
    }),
  }),
});

export type DisclosureCollectionStatus =
  "AVAILABLE" | "DELAYED" | "BLOCKED_EXTERNAL" | "NOT_VERIFIED";

type CitationResult = ReturnType<typeof recordDisclosureCitation> & {
  provider: DisclosureProvider;
  title: string;
};
export type DisclosureCollectionResult = {
  status: DisclosureCollectionStatus;
  reason: string;
  records: CitationResult[];
};
type Fetcher = typeof fetch;

class SourceHttpError extends Error {
  constructor(readonly statusCode: number) {
    super("source_http_error");
  }
}

function collectionResult(
  status: DisclosureCollectionStatus,
  reason: string,
  records: CitationResult[] = [],
): DisclosureCollectionResult {
  return { status, reason, records };
}

function requestFailure(error: unknown): DisclosureCollectionResult {
  if (error instanceof SourceHttpError) {
    return collectionResult(
      "NOT_VERIFIED",
      `Official source returned HTTP ${error.statusCode}; no records were accepted.`,
    );
  }
  return collectionResult(
    "NOT_VERIFIED",
    "The request or response could not be verified; no records were accepted.",
  );
}

function reserveRequest(
  database: AppDatabase,
  provider: DisclosureProvider,
  requestLimit: number,
  windowMs: number,
): boolean {
  const threshold = BigInt(Date.now() - windowMs);
  return withTransaction(database, () => {
    const requests = database.orm
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, "DISCLOSURE_SOURCE_REQUEST"),
          eq(auditEvents.entityId, provider),
          eq(auditEvents.action, "REQUESTED"),
          gte(auditEvents.recordedAtMs, threshold),
        ),
      )
      .limit(requestLimit)
      .all();
    if (requests.length >= requestLimit) return false;

    recordAuditEvent(database, {
      entityType: "DISCLOSURE_SOURCE_REQUEST",
      entityId: provider,
      action: "REQUESTED",
      payload: { provider },
    });
    return true;
  });
}

async function requestText(
  url: URL,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<string> {
  const response = await fetcher(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new SourceHttpError(response.status);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("source_response_too_large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("source_response_too_large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

async function requestJson(
  url: URL,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<unknown> {
  return JSON.parse(await requestText(url, init, fetcher)) as unknown;
}

function persistCitations(
  database: AppDatabase,
  inputs: DisclosureCitationInput[],
): CitationResult[] {
  return withTransaction(database, () =>
    inputs.map((input) => ({
      ...persistCitation(database, input),
      provider: input.provider,
      title: input.title,
    })),
  );
}

function contentFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function persistCitation(
  database: AppDatabase,
  input: DisclosureCitationInput,
): ReturnType<typeof recordDisclosureCitation> {
  try {
    return recordDisclosureCitation(database, input);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "disclosure_identity_content_conflict"
    ) {
      throw error;
    }
    const citation = normalizeDisclosureCitation(input);
    const source = database.orm
      .select()
      .from(sources)
      .where(eq(sources.sourceKey, citation.source.sourceKey))
      .get();
    if (!source) throw error;
    const previous = database.orm
      .select()
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.sourceId, source.id),
          eq(sourceRecords.recordKey, `disclosure:${input.externalId}`),
        ),
      )
      .orderBy(desc(sourceRecords.recordVersion))
      .limit(1)
      .get();
    if (!previous) throw error;
    if (
      previous.contentHashSha256 ===
      createHash("sha256").update(citation.record.content).digest("hex")
    ) {
      return { duplicate: true, record: previous, source };
    }
    return recordDisclosureCitation(database, {
      ...input,
      recordVersion: previous.recordVersion + 1,
      supersedesRecordId: previous.id,
    });
  }
}

export async function collectSecFilings(
  database: AppDatabase,
  input: { cik: string; userAgent: string },
  fetcher: Fetcher = fetch,
): Promise<DisclosureCollectionResult> {
  const parsedInput = secInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      "A valid CIK and SEC-compliant User-Agent with contact email are required.",
    );
  }
  const { cik, userAgent } = parsedInput.data;
  if (
    !reserveRequest(
      database,
      "sec.edgar",
      SEC_REQUEST_LIMIT,
      SEC_REQUEST_WINDOW_MS,
    )
  ) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      "The local SEC request limit of 10 requests per rolling second has been reached.",
    );
  }

  const paddedCik = cik.padStart(10, "0");
  let citations: DisclosureCitationInput[];
  try {
    const response = secResponseSchema.parse(
      await requestJson(
        new URL(`CIK${paddedCik}.json`, secEndpoint),
        { headers: { Accept: "application/json", "User-Agent": userAgent } },
        fetcher,
      ),
    );
    const { accessionNumber, filingDate, form } = response.filings.recent;
    if (
      accessionNumber.length !== filingDate.length ||
      accessionNumber.length !== form.length
    ) {
      throw new Error("sec_column_lengths_mismatch");
    }
    const cikNumber = BigInt(cik).toString();
    citations = accessionNumber.map((externalId, index) => {
      if (
        !/^\d{10}-\d{2}-\d{6}$/.test(externalId) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(filingDate[index] ?? "") ||
        !form[index]
      ) {
        throw new Error("invalid_sec_filing_reference");
      }
      const compactId = externalId.replaceAll("-", "");
      return {
        provider: "sec.edgar" as const,
        externalId,
        referenceUrl: `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${compactId}/${externalId}-index.html`,
        title: `${form[index]} filing (${filingDate[index]})`,
        contentFingerprint: contentFingerprint({
          accessionNumber: externalId,
          filingDate: filingDate[index],
          form: form[index],
        }),
        dataClass: "REAL",
        rawTimeText: filingDate[index] ?? null,
        sourceTimeZone: null,
      };
    });
  } catch (error) {
    return requestFailure(error);
  }
  const records = persistCitations(database, citations);
  return collectionResult(
    "AVAILABLE",
    records.length
      ? `Retrieved ${records.length} SEC filing references; filing dates do not establish first public availability time.`
      : "SEC responded with no filing references; this is not a no-event assertion.",
    records,
  );
}

export async function collectBojSeries(
  database: AppDatabase,
  input: z.input<typeof bojInputSchema>,
  fetcher: Fetcher = fetch,
): Promise<DisclosureCollectionResult> {
  const parsedInput = bojInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return collectionResult(
      "NOT_VERIFIED",
      "BOJ query parameters are invalid.",
    );
  }
  const { databaseCode, seriesCodes, startDate, endDate } = parsedInput.data;
  if (
    !reserveRequest(
      database,
      "boj.timeseries",
      BOJ_REQUEST_LIMIT,
      BOJ_REQUEST_WINDOW_MS,
    )
  ) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      "The local BOJ request limit of one request per rolling second has been reached.",
    );
  }
  const url = new URL(bojEndpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  url.searchParams.set("db", databaseCode);
  url.searchParams.set("code", seriesCodes.join(","));
  if (startDate) url.searchParams.set("startDate", startDate);
  if (endDate) url.searchParams.set("endDate", endDate);

  let citations: DisclosureCitationInput[];
  let observationCount = 0;
  let acceptedObservationCount = 0;
  try {
    const response = bojResponseSchema.parse(
      await requestJson(
        url,
        { headers: { Accept: "application/json" } },
        fetcher,
      ),
    );
    if (
      response.STATUS !== 200 ||
      (response.NEXTPOSITION !== null && response.NEXTPOSITION !== undefined)
    ) {
      throw new Error("boj_incomplete_response");
    }
    const returnedCodes = new Set(
      response.RESULTSET.map((item) => item.SERIES_CODE),
    );
    if (
      returnedCodes.size !== response.RESULTSET.length ||
      returnedCodes.size !== seriesCodes.length ||
      seriesCodes.some((seriesCode) => !returnedCodes.has(seriesCode))
    ) {
      throw new Error("boj_series_coverage_mismatch");
    }

    const todayInTokyo = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date(Date.now()))
      .replaceAll("-", "");
    citations = [];
    for (const series of response.RESULTSET) {
      const { SURVEY_DATES: surveyDates, VALUES: values } = series.VALUES;
      if (
        surveyDates.length !== values.length ||
        observationCount + values.length > 60_000
      ) {
        throw new Error("boj_observation_coverage_mismatch");
      }
      observationCount += values.length;
      for (const [index, surveyDate] of surveyDates.entries()) {
        const value = values[index];
        const period = String(surveyDate);
        if (
          value === null ||
          value === "" ||
          (/^\d{8}$/.test(period) && period >= todayInTokyo)
        ) {
          continue;
        }
        acceptedObservationCount += 1;
        citations.push({
          provider: "boj.timeseries",
          externalId: `${series.SERIES_CODE}:${period}`,
          recordType: "OTHER",
          referenceUrl: bojEndpoint,
          title: `${series.SERIES_CODE} ${series.NAME_OF_TIME_SERIES} (${series.UNIT}) ${period}: ${value}`,
          contentFingerprint: contentFingerprint({
            name: series.NAME_OF_TIME_SERIES,
            unit: series.UNIT,
            frequency: series.FREQUENCY,
            category: series.CATEGORY,
            lastUpdate: series.LAST_UPDATE ?? null,
            surveyDate,
            value,
          }),
          rawTimeText: period,
          sourceTimeZone: "Asia/Tokyo",
          dataClass: "HISTORICAL",
        });
      }
    }
  } catch (error) {
    return requestFailure(error);
  }
  const records = persistCitations(database, citations);
  return collectionResult(
    "AVAILABLE",
    acceptedObservationCount
      ? `Accepted ${acceptedObservationCount} BOJ observations with values; excluded ${observationCount - acceptedObservationCount} blank or not-yet-complete observations. Survey dates are observation periods, not release times.`
      : "BOJ returned no usable observations for completed Tokyo dates; this is not a no-event assertion.",
    records,
  );
}

export async function collectBlsSeries(
  database: AppDatabase,
  input: {
    seriesIds: string[];
    startYear?: string;
    endYear?: string;
  },
  fetcher: Fetcher = fetch,
): Promise<DisclosureCollectionResult> {
  const parsedInput = blsInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return collectionResult(
      "NOT_VERIFIED",
      "BLS v1 query must include 1–25 unique series and no more than 10 years.",
    );
  }
  const { seriesIds, startYear, endYear } = parsedInput.data;
  if (
    !reserveRequest(
      database,
      "bls.api",
      BLS_REQUEST_LIMIT,
      BLS_REQUEST_WINDOW_MS,
    )
  ) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      "The local BLS v1 limit of 25 requests per rolling 24 hours has been reached.",
    );
  }

  const body = {
    seriesid: seriesIds,
    ...(startYear && endYear ? { startyear: startYear, endyear: endYear } : {}),
  };
  let citations: DisclosureCitationInput[];
  let unavailableObservationCount = 0;
  try {
    const response = blsResponseSchema.parse(
      await requestJson(
        new URL(blsEndpoint),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        fetcher,
      ),
    );
    if (response.status !== "REQUEST_SUCCEEDED" || response.message.length) {
      throw new Error("bls_request_not_succeeded");
    }
    const series = response.Results.series;
    const returnedIds = new Set(series.map((item) => item.seriesID));
    if (
      returnedIds.size !== series.length ||
      returnedIds.size !== seriesIds.length ||
      seriesIds.some((seriesId) => !returnedIds.has(seriesId))
    ) {
      throw new Error("bls_series_coverage_mismatch");
    }
    citations = series.flatMap((item) =>
      item.data
        .filter((observation) => /^[-+]?\d+(?:\.\d+)?$/.test(observation.value))
        .map((observation) => ({
          provider: "bls.api" as const,
          externalId: `${item.seriesID}:${observation.year}:${observation.period}`,
          recordType: "OTHER" as const,
          referenceUrl: blsEndpoint,
          title: `${item.seriesID} ${observation.periodName} ${observation.year}: ${observation.value}`,
          contentFingerprint: contentFingerprint(observation),
          rawTimeText: `${observation.year} ${observation.period} (${observation.periodName})`,
          sourceTimeZone: null,
          dataClass: "HISTORICAL" as const,
        })),
    );
    unavailableObservationCount =
      series.reduce((count, item) => count + item.data.length, 0) -
      citations.length;
  } catch (error) {
    return requestFailure(error);
  }
  const records = persistCitations(database, citations);
  return collectionResult(
    "DELAYED",
    records.length
      ? `Retrieved ${records.length} numeric BLS observations; excluded ${unavailableObservationCount} unavailable values. API v1 data is delayed and does not establish a release timestamp.`
      : "BLS returned no numeric observations; this is not a no-event assertion.",
    records,
  );
}

type RssProvider = "boj.rss" | "federalreserve.rss";

async function collectOfficialRss(
  database: AppDatabase,
  input: { feedUrl: string },
  config: {
    provider: RssProvider;
    allowedDomain: string;
    feedPathPrefix: string;
    requestLimit: number;
    requestWindowMs: number;
    publisher: string;
    timeZone: string;
  },
  fetcher: Fetcher = fetch,
): Promise<DisclosureCollectionResult> {
  const parsedInput = feedInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      `A verified ${config.publisher} feed URL is required.`,
    );
  }
  let feedUrl: URL;
  let citations: DisclosureCitationInput[];
  try {
    feedUrl = new URL(parsedInput.data.feedUrl);
  } catch {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      `A verified ${config.publisher} feed URL is required.`,
    );
  }
  if (
    feedUrl.protocol !== "https:" ||
    feedUrl.username ||
    feedUrl.password ||
    !feedUrl.pathname.startsWith(config.feedPathPrefix) ||
    !isOfficialDomain(feedUrl.hostname, config.allowedDomain)
  ) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      `Only official ${config.publisher} HTTPS feeds are allowed.`,
    );
  }
  if (
    !reserveRequest(
      database,
      config.provider,
      config.requestLimit,
      config.requestWindowMs,
    )
  ) {
    return collectionResult(
      "BLOCKED_EXTERNAL",
      `The local ${config.publisher} feed request limit has been reached.`,
    );
  }

  try {
    const xml = await requestText(
      feedUrl,
      { headers: { Accept: "application/rss+xml, application/xml, text/xml" } },
      fetcher,
    );
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("rss_dtd_not_allowed");
    if (XMLValidator.validate(xml) !== true) throw new Error("invalid_rss_xml");
    const parsed = rssResponseSchema.parse(
      new XMLParser({
        ignoreAttributes: true,
        processEntities: false,
        parseTagValue: false,
        trimValues: true,
        maxNestedTags: 20,
      }).parse(xml),
    );
    const itemResult = parsed.rss.channel.item;
    const items = !itemResult
      ? []
      : Array.isArray(itemResult)
        ? itemResult
        : [itemResult];
    citations = items.map((item) => {
      const link = textValue(item.link);
      const guid = item.guid ? textValue(item.guid) : link;
      const rawTimeText = item.pubDate ? textValue(item.pubDate) : null;
      const itemUrl = new URL(link);
      const httpLinkFromOfficialFeed =
        itemUrl.protocol === "http:" &&
        config.provider === "boj.rss" &&
        isOfficialDomain(itemUrl.hostname, config.allowedDomain);
      if (httpLinkFromOfficialFeed) itemUrl.protocol = "https:";
      if (
        guid.length > 220 ||
        /[\r\n\0]/.test(guid) ||
        (rawTimeText?.length ?? 0) > 200 ||
        itemUrl.protocol !== "https:" ||
        itemUrl.username ||
        itemUrl.password ||
        !isOfficialDomain(itemUrl.hostname, config.allowedDomain)
      ) {
        throw new Error("invalid_rss_item_fields");
      }
      const publishedAtMs = rawTimeText ? Date.parse(rawTimeText) : Number.NaN;
      return {
        provider: config.provider,
        externalId: guid,
        referenceUrl: itemUrl.toString(),
        title: textValue(item.title),
        contentFingerprint: contentFingerprint({
          guid,
          title: textValue(item.title),
          rawTimeText,
        }),
        dataClass: "REAL",
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : null,
        rawTimeText,
        sourceTimeZone: config.timeZone,
      };
    });
  } catch (error) {
    return requestFailure(error);
  }
  const records = persistCitations(database, citations);
  return collectionResult(
    "AVAILABLE",
    records.length
      ? `Retrieved ${records.length} ${config.publisher} RSS references.`
      : `${config.publisher} feed returned no items; this is not a no-event assertion.`,
    records,
  );
}

export function collectFederalReserveRss(
  database: AppDatabase,
  input: { feedUrl: string },
  fetcher: Fetcher = fetch,
) {
  return collectOfficialRss(
    database,
    input,
    {
      provider: "federalreserve.rss",
      allowedDomain: "federalreserve.gov",
      feedPathPrefix: "/feeds/",
      requestLimit: FED_REQUEST_LIMIT,
      requestWindowMs: FED_REQUEST_WINDOW_MS,
      publisher: "Federal Reserve",
      timeZone: "America/New_York",
    },
    fetcher,
  );
}

export function collectBojRss(
  database: AppDatabase,
  input: { feedUrl: string },
  fetcher: Fetcher = fetch,
) {
  return collectOfficialRss(
    database,
    input,
    {
      provider: "boj.rss",
      allowedDomain: "boj.or.jp",
      feedPathPrefix: "/en/rss/",
      requestLimit: BOJ_RSS_REQUEST_LIMIT,
      requestWindowMs: BOJ_RSS_REQUEST_WINDOW_MS,
      publisher: "Bank of Japan",
      timeZone: "Asia/Tokyo",
    },
    fetcher,
  );
}

function textValue(value: string | { "#text": string }): string {
  return typeof value === "string" ? value : value["#text"];
}

function isOfficialDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}
