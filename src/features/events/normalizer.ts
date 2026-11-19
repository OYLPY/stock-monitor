import { z } from "zod";

import type { AppDatabase } from "../../db/index.ts";
import type { DisclosureCollectionResult } from "../../providers/disclosures/index.ts";
import {
  appendMarketEventRevision,
  createMarketEvent,
  listMarketEvents,
} from "../evidence/repository.ts";
import type { MarketEventRevisionInput } from "../evidence/repository.ts";

const rssProviders = {
  "boj.rss": {
    category: "BANK_OF_JAPAN_NOTICE",
    host: "boj.or.jp",
    marketCode: "JP",
    timeZone: "Asia/Tokyo",
  },
  "federalreserve.rss": {
    category: "FEDERAL_RESERVE_NOTICE",
    host: "federalreserve.gov",
    marketCode: "US",
    timeZone: "America/New_York",
  },
} as const;

type CollectedRecord = DisclosureCollectionResult["records"][number];
const dataClassSchema = z.enum([
  "REAL",
  "DELAYED",
  "HISTORICAL",
  "FIXTURE",
  "NOT_VERIFIED",
]);
const evidenceRelationSchema = z.enum(["SUPPORTS", "CONTRADICTS", "CONTEXT"]);

function normalizeHeadline(
  record: CollectedRecord,
  nowMs: number,
): MarketEventRevisionInput | null {
  if (
    record.provider !== "boj.rss" &&
    record.provider !== "federalreserve.rss"
  ) {
    return null;
  }

  const provider = record.provider;
  const policy = rssProviders[provider];
  const publishedAtMs =
    record.record.publishedAtMs === null
      ? Number.NaN
      : Number(record.record.publishedAtMs);
  const occurredAtMs =
    record.record.occurredAtMs === null
      ? null
      : Number(record.record.occurredAtMs);
  const dataClass = dataClassSchema.safeParse(record.record.dataClass);
  let canonicalUrl: URL;
  try {
    canonicalUrl = new URL(record.record.canonicalUrl ?? "");
  } catch {
    return null;
  }

  const title = record.title.trim().replace(/\s+/g, " ").normalize("NFC");
  if (
    record.record.recordType !== "DISCLOSURE" ||
    !dataClass.success ||
    record.source.sourceKey !== provider ||
    record.source.authorityRole !== "REGULATORY_PRIMARY" ||
    canonicalUrl.protocol !== "https:" ||
    canonicalUrl.username ||
    canonicalUrl.password ||
    !(
      canonicalUrl.hostname === policy.host ||
      canonicalUrl.hostname.endsWith(`.${policy.host}`)
    ) ||
    !title ||
    !Number.isSafeInteger(publishedAtMs) ||
    publishedAtMs < 0 ||
    publishedAtMs > nowMs ||
    (occurredAtMs !== null &&
      (!Number.isSafeInteger(occurredAtMs) ||
        occurredAtMs < 0 ||
        occurredAtMs > nowMs)) ||
    record.record.sourceTimeZone !== policy.timeZone
  ) {
    return null;
  }

  const verificationLevel =
    dataClass.data === "FIXTURE"
      ? "DEMO_ONLY"
      : dataClass.data === "NOT_VERIFIED" ||
          record.source.licenseStatus === "NOT_VERIFIED"
        ? "NOT_VERIFIED"
        : "PARTIAL";

  return {
    category: policy.category,
    summary: title,
    marketCode: policy.marketCode,
    instrument: null,
    occurredAtMs,
    publishedAtMs,
    importanceReason:
      "Official RSS headline only; event significance and market impact are not assessed here.",
    dataClass: dataClass.data,
    verificationLevel,
    verificationReason:
      "The official feed reference is archived; article body, affected security, and market impact are not inferred.",
    verificationRuleVersion: "official-rss-headline-v1",
    primarySourceRecordId: record.record.id,
    evidence: [{ sourceRecordId: record.record.id, relation: "SUPPORTS" }],
  };
}

export function normalizeOfficialRssEvents(
  database: AppDatabase,
  records: CollectedRecord[],
  nowMs: number,
) {
  const result = { created: 0, revised: 0, unchanged: 0, rejected: 0 };
  const eventsBySourceRecord = new Map<
    string,
    {
      eventId: string;
      sourceRecordIds: Set<string>;
      latestEvidence: MarketEventRevisionInput["evidence"];
    }
  >();

  for (const event of listMarketEvents(database)) {
    const latest = event.revisions.at(-1);
    if (!latest) continue;
    for (const revision of event.revisions) {
      for (const evidence of revision.evidence) {
        const key = `${evidence.sourceKey}\0${evidence.recordKey}`;
        const stored = eventsBySourceRecord.get(key) ?? {
          eventId: event.id,
          sourceRecordIds: new Set<string>(),
          latestEvidence: [],
        };
        stored.sourceRecordIds.add(evidence.sourceRecordId);
        if (revision.id === latest.id) {
          stored.latestEvidence = latest.evidence.map((item) => ({
            sourceRecordId: item.sourceRecordId,
            relation: evidenceRelationSchema.parse(item.relation),
          }));
        }
        eventsBySourceRecord.set(key, stored);
      }
    }
  }

  for (const record of records) {
    const input = normalizeHeadline(record, nowMs);
    if (!input) {
      result.rejected += 1;
      continue;
    }

    const identity = `${record.provider}\0${record.record.recordKey}`;
    const existing = eventsBySourceRecord.get(identity);
    if (!existing) {
      const event = createMarketEvent(database, input);
      eventsBySourceRecord.set(identity, {
        eventId: event.id,
        sourceRecordIds: new Set([record.record.id]),
        latestEvidence: input.evidence,
      });
      result.created += 1;
      continue;
    }

    if (existing.sourceRecordIds.has(record.record.id)) {
      result.unchanged += 1;
      continue;
    }

    const evidence = [...existing.latestEvidence];
    evidence.push({
      sourceRecordId: record.record.id,
      relation: "SUPPORTS",
    });
    appendMarketEventRevision(database, existing.eventId, {
      ...input,
      evidence,
    });
    existing.sourceRecordIds.add(record.record.id);
    existing.latestEvidence = evidence;
    result.revised += 1;
  }

  return result;
}
