import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../../db";
import { sourceRecords, sources } from "../../db/schema";
import {
  appendSourceRecord,
  registerSource,
} from "../../features/evidence/repository";
import type { SourceInput } from "../../features/evidence/repository";

const officialSourcePolicies = {
  "sec.edgar": {
    publisher: "U.S. Securities and Exchange Commission EDGAR",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl:
      "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    licenseUrl: null,
    licenseStatus: "VERIFIED",
    credentialRequirement: "NOT_REQUIRED",
    accessMode: "PUBLIC_API",
    allowedDomain: "sec.gov",
    timeZone: "America/New_York",
    requestPolicy:
      "Maximum 10 requests per second; identify the client with User-Agent.",
  },
  "edinet.v2": {
    publisher: "Japan Financial Services Agency EDINET",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: "https://disclosure2.edinet-fsa.go.jp/",
    licenseUrl:
      "https://disclosure2.edinet-fsa.go.jp/guide/static/disclosure/WZEK0030.html",
    licenseStatus: "UNKNOWN",
    credentialRequirement: "REQUIRED",
    accessMode: "API_KEY_REQUIRED",
    allowedDomain: "edinet-fsa.go.jp",
    timeZone: "Asia/Tokyo",
    requestPolicy:
      "API key required; use the official frequency guidance and retain document availability flags.",
  },
  "tdnet.api": {
    publisher: "Japan Exchange Group TDnet",
    sourceType: "EXCHANGE",
    authorityRole: "EXCHANGE_PRIMARY",
    referenceUrl:
      "https://www.jpx.co.jp/english/markets/paid-info-listing/tdnet/02.html",
    licenseUrl:
      "https://www.jpx.co.jp/english/markets/paid-info-listing/tdnet/p1j4l40000000q03-att/API_ServiceGuideE.pdf",
    licenseStatus: "UNKNOWN",
    credentialRequirement: "REQUIRED",
    accessMode: "PAID_API_DISABLED",
    allowedDomain: "jpx.co.jp",
    timeZone: "Asia/Tokyo",
    requestPolicy:
      "Paid subscription; disabled until paid access is explicitly authorized.",
  },
  "boj.timeseries": {
    publisher: "Bank of Japan Time-Series Data Search",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: "https://www.stat-search.boj.or.jp/index_en.html",
    licenseUrl: null,
    licenseStatus: "UNKNOWN",
    credentialRequirement: "NOT_REQUIRED",
    accessMode: "PUBLIC_API",
    allowedDomain: "boj.or.jp",
    timeZone: "Asia/Tokyo",
    requestPolicy:
      "A query is limited to 60,000 observations; excessive request frequency may be restricted.",
  },
  "boj.rss": {
    publisher: "Bank of Japan",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: "https://www.boj.or.jp/en/whatsnew/index.htm",
    licenseUrl: null,
    licenseStatus: "UNKNOWN",
    credentialRequirement: "NOT_REQUIRED",
    accessMode: "PUBLIC_FEED",
    allowedDomain: "boj.or.jp",
    timeZone: "Asia/Tokyo",
    requestPolicy:
      "Public RSS feed; no numeric polling quota was verified, so collection must remain demand-driven.",
  },
  "federalreserve.rss": {
    publisher: "Board of Governors of the Federal Reserve System",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: "https://www.federalreserve.gov/feeds/feeds.htm",
    licenseUrl: null,
    licenseStatus: "UNKNOWN",
    credentialRequirement: "NOT_REQUIRED",
    accessMode: "PUBLIC_FEED",
    allowedDomain: "federalreserve.gov",
    timeZone: "America/New_York",
    requestPolicy:
      "Public RSS feed; no numeric polling quota was verified, so collection must remain demand-driven.",
  },
  "bls.api": {
    publisher: "U.S. Bureau of Labor Statistics",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: "https://www.bls.gov/developers/api_faqs.htm",
    licenseUrl: null,
    licenseStatus: "UNKNOWN",
    credentialRequirement: "NOT_REQUIRED",
    accessMode: "PUBLIC_API",
    allowedDomain: "bls.gov",
    timeZone: "America/New_York",
    requestPolicy:
      "Public API v1 is limited to 25 requests per day, 25 series per request, and 10 years of data.",
  },
  "bea.api": {
    publisher: "U.S. Bureau of Economic Analysis",
    sourceType: "REGULATORY",
    authorityRole: "REGULATORY_PRIMARY",
    referenceUrl: "https://apps.bea.gov/API/swagger/index.htm",
    licenseUrl: "https://apps.bea.gov/api/_pdf/bea_api_tos.pdf",
    licenseStatus: "UNKNOWN",
    credentialRequirement: "REQUIRED",
    accessMode: "API_KEY_REQUIRED",
    allowedDomain: "bea.gov",
    timeZone: "America/New_York",
    requestPolicy: "API key required; follow BEA throttling and terms.",
  },
} as const;

export type DisclosureProvider =
  keyof typeof officialSourcePolicies | "issuer.ir";
export type DisclosureAccessMode =
  | (typeof officialSourcePolicies)[keyof typeof officialSourcePolicies]["accessMode"]
  | "MANUAL_REFERENCE";

export const disclosureSourcePolicies = {
  ...officialSourcePolicies,
  "issuer.ir": {
    accessMode: "MANUAL_REFERENCE",
    requestPolicy:
      "Issuer-specific; retain only an explicitly supplied official URL and do not crawl by default.",
  },
} satisfies Record<
  DisclosureProvider,
  { accessMode: DisclosureAccessMode; requestPolicy: string } & Record<
    string,
    unknown
  >
>;

export function getDisclosureSourceState(
  provider: DisclosureProvider,
  credentialConfigured = false,
) {
  const policy = disclosureSourcePolicies[provider];
  if (policy.accessMode === "API_KEY_REQUIRED" && !credentialConfigured) {
    return {
      status: "BLOCKED_EXTERNAL" as const,
      reason: "API credentials are required and are not configured.",
    };
  }
  if (policy.accessMode === "PAID_API_DISABLED") {
    return {
      status: "BLOCKED_EXTERNAL" as const,
      reason: "This paid source is outside the authorized service scope.",
    };
  }
  if (policy.accessMode === "MANUAL_REFERENCE") {
    return {
      status: "BLOCKED_EXTERNAL" as const,
      reason: "Issuer-specific references require manual verification.",
    };
  }
  return {
    status: "NOT_VERIFIED" as const,
    reason: "No external request has verified source availability.",
  };
}

const timestampSchema = z.number().int().safe().nullable().default(null);
const citationInputSchema = z.strictObject({
  provider: z.enum([
    "sec.edgar",
    "edinet.v2",
    "tdnet.api",
    "boj.timeseries",
    "boj.rss",
    "federalreserve.rss",
    "bls.api",
    "bea.api",
    "issuer.ir",
  ]),
  externalId: z.string().trim().min(1).max(220),
  publisher: z.string().trim().min(1).max(160).optional(),
  referenceUrl: z.string().url(),
  title: z.string().trim().min(1).max(500),
  recordType: z.enum(["DISCLOSURE", "OTHER"]).default("DISCLOSURE"),
  contentFingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
  publishedAtMs: timestampSchema,
  occurredAtMs: timestampSchema,
  availableAtMs: timestampSchema,
  rawTimeText: z.string().max(200).nullable().default(null),
  sourceTimeZone: z.string().max(64).nullable().optional(),
  dataClass: z
    .enum(["REAL", "DELAYED", "HISTORICAL", "NOT_VERIFIED"])
    .default("NOT_VERIFIED"),
  recordVersion: z.number().int().min(1).max(2_147_483_647).default(1),
  supersedesRecordId: z.string().uuid().nullable().default(null),
});

export type DisclosureCitationInput = z.input<typeof citationInputSchema>;

function isHostAllowed(host: string, allowedDomain: string): boolean {
  return host === allowedDomain || host.endsWith(`.${allowedDomain}`);
}

function normalizeSourceKey(
  provider: DisclosureProvider,
  referenceUrl: URL,
): string {
  return provider === "issuer.ir"
    ? `issuer.ir.${referenceUrl.hostname}`
    : provider;
}

function createSourceInput(
  provider: DisclosureProvider,
  sourceKey: string,
  publisher: string | undefined,
  referenceUrl: URL,
): SourceInput {
  if (provider === "issuer.ir") {
    return {
      sourceKey,
      publisher: publisher ?? referenceUrl.hostname,
      sourceType: "ISSUER",
      authorityRole: "ISSUER_PRIMARY",
      referenceUrl: referenceUrl.toString(),
      licenseUrl: null,
      licenseStatus: "UNKNOWN",
      credentialRequirement: "UNKNOWN",
    };
  }

  const policy = officialSourcePolicies[provider];
  return {
    sourceKey,
    publisher: policy.publisher,
    sourceType: policy.sourceType,
    authorityRole: policy.authorityRole,
    referenceUrl: policy.referenceUrl,
    licenseUrl: policy.licenseUrl,
    licenseStatus: policy.licenseStatus,
    credentialRequirement: policy.credentialRequirement,
  };
}

function sourceRecordContent(input: {
  provider: DisclosureProvider;
  externalId: string;
  title: string;
  recordType?: "DISCLOSURE" | "OTHER";
  contentFingerprint?: string | null;
  publishedAtMs: number | null;
  occurredAtMs: number | null;
  availableAtMs: number | null;
  rawTimeText: string | null;
  sourceTimeZone: string | null;
}): string {
  const { recordType, contentFingerprint, ...previousShape } = input;
  return JSON.stringify({
    ...previousShape,
    ...(recordType && recordType !== "DISCLOSURE" ? { recordType } : {}),
    ...(contentFingerprint ? { contentFingerprint } : {}),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeDisclosureCitation(input: DisclosureCitationInput) {
  const parsed = citationInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_disclosure_citation");

  const referenceUrl = new URL(parsed.data.referenceUrl);
  if (
    referenceUrl.protocol !== "https:" ||
    referenceUrl.username ||
    referenceUrl.password
  ) {
    throw new Error("unsafe_disclosure_reference_url");
  }

  if (parsed.data.provider === "issuer.ir") {
    if (!parsed.data.publisher) throw new Error("issuer_publisher_required");
  } else if (
    !isHostAllowed(
      referenceUrl.hostname,
      officialSourcePolicies[parsed.data.provider].allowedDomain,
    )
  ) {
    throw new Error("untrusted_disclosure_reference_host");
  }

  referenceUrl.search = "";
  referenceUrl.hash = "";
  if (referenceUrl.pathname.length > 1) {
    referenceUrl.pathname = referenceUrl.pathname.replace(/\/+$/, "");
  }

  const sourceKey = normalizeSourceKey(parsed.data.provider, referenceUrl);
  const sourceTimeZone =
    parsed.data.sourceTimeZone === undefined
      ? parsed.data.provider === "issuer.ir"
        ? null
        : officialSourcePolicies[parsed.data.provider].timeZone
      : parsed.data.sourceTimeZone;
  const source = createSourceInput(
    parsed.data.provider,
    sourceKey,
    parsed.data.publisher,
    new URL(referenceUrl.origin),
  );
  const content = sourceRecordContent({
    provider: parsed.data.provider,
    externalId: parsed.data.externalId,
    title: parsed.data.title,
    recordType: parsed.data.recordType,
    contentFingerprint: parsed.data.contentFingerprint ?? null,
    publishedAtMs: parsed.data.publishedAtMs,
    occurredAtMs: parsed.data.occurredAtMs,
    availableAtMs: parsed.data.availableAtMs,
    rawTimeText: parsed.data.rawTimeText,
    sourceTimeZone,
  });

  return {
    source,
    record: {
      recordKey: `disclosure:${parsed.data.externalId}`,
      recordType: parsed.data.recordType,
      recordVersion: parsed.data.recordVersion,
      supersedesRecordId: parsed.data.supersedesRecordId,
      publishedAtMs: parsed.data.publishedAtMs,
      occurredAtMs: parsed.data.occurredAtMs,
      availableAtMs: parsed.data.availableAtMs,
      rawTimeText: parsed.data.rawTimeText,
      sourceTimeZone,
      canonicalUrl: referenceUrl.toString(),
      dataClass: parsed.data.dataClass,
      content,
    },
  };
}

export function recordDisclosureCitation(
  database: AppDatabase,
  input: DisclosureCitationInput,
) {
  const citation = normalizeDisclosureCitation(input);
  const existingSource = database.orm
    .select()
    .from(sources)
    .where(eq(sources.sourceKey, citation.source.sourceKey))
    .get();
  const source = existingSource ?? registerSource(database, citation.source);
  const contentHashSha256 = sha256(citation.record.content);
  const existingRecord = database.orm
    .select()
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.sourceId, source.id),
        eq(sourceRecords.recordKey, citation.record.recordKey),
        eq(sourceRecords.recordVersion, citation.record.recordVersion),
      ),
    )
    .get();

  if (existingRecord) {
    if (existingRecord.contentHashSha256 !== contentHashSha256) {
      throw new Error("disclosure_identity_content_conflict");
    }
    return { duplicate: true, record: existingRecord, source };
  }

  const record = appendSourceRecord(database, {
    sourceId: source.id,
    ...citation.record,
  });
  return { duplicate: false, record, source };
}

export {
  collectBlsSeries,
  collectBojSeries,
  collectBojRss,
  collectFederalReserveRss,
  collectSecFilings,
} from "./collectors";
export type {
  DisclosureCollectionResult,
  DisclosureCollectionStatus,
} from "./collectors";
