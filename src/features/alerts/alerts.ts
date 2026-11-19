import { randomUUID } from "node:crypto";

import type { AppDatabase } from "../../db/index.ts";
import { marketWatchSourceWatermarks, notifications } from "../../db/schema.ts";
import type { DisclosureCollectionStatus } from "../../providers/disclosures/index.ts";
import { listMarketEvents } from "../evidence/repository.ts";

const RULE_VERSION = "p11-03-v1";
const NOTIFICATION_LIMIT = 3;
const IMPORTANCE_RULE_PATTERN = /^P11-03:([A-Z][A-Z0-9_]{0,63}):\s*(.+)$/;
const TRUSTED_PRIMARY_ROLES = new Set([
  "EXCHANGE_PRIMARY",
  "ISSUER_PRIMARY",
  "REGULATORY_PRIMARY",
]);

export const MARKET_WATCH_SOURCE_KEYS = [
  "boj.rss",
  "federalreserve.rss",
] as const;

export type MarketWatchSourceKey = (typeof MARKET_WATCH_SOURCE_KEYS)[number];
export type MarketWatchSourceState = {
  sourceKey: MarketWatchSourceKey;
  status: DisclosureCollectionStatus;
};

type Confidence = "LOW" | "MEDIUM" | "HIGH";
type Outcome =
  | "BASELINED"
  | "SUPPRESSED"
  | "ALREADY_NOTIFIED"
  | "SELECTED"
  | "DEFERRED_LIMIT";
export type AlertEvidence = {
  relation: string;
  source_record_id: string;
  canonical_url: string | null;
  published_at_ms: number | null;
  collected_at_ms: number;
  source_key: string;
  publisher: string;
  authority_role: string;
  license_status: string;
};

function safeNumber(value: bigint | number) {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue))
    throw new Error("alert_timestamp_out_of_range");
  return numberValue;
}

function importanceRuleId(reason: string) {
  return IMPORTANCE_RULE_PATTERN.exec(reason)?.[1] ?? null;
}

export function readMarketWatchSourceWatermarks(database: AppDatabase) {
  return new Map(
    database.orm
      .select()
      .from(marketWatchSourceWatermarks)
      .all()
      .map(({ sourceKey, lastSuccessAtMs }) => [
        sourceKey,
        safeNumber(lastSuccessAtMs),
      ]),
  );
}

export function processMarketWatchAlerts(
  database: AppDatabase,
  input: {
    taskRunId: string;
    asOfMs: number;
    openMarkets: readonly ("JP" | "US")[];
    previousWatermarks: ReadonlyMap<string, number>;
    sourceStates: readonly MarketWatchSourceState[];
  },
) {
  const availableSources = new Set<string>(
    input.sourceStates
      .filter(({ status }) => status === "AVAILABLE")
      .map(({ sourceKey }) => sourceKey),
  );
  const baselineSources = [...availableSources].filter(
    (sourceKey) => !input.previousWatermarks.has(sourceKey),
  );
  const baselineSourceSet = new Set<string>(baselineSources);
  const candidates: {
    eventId: string;
    revisionId: string;
    marketCode: "JP" | "US" | null;
    publishedAtMs: number | null;
    importanceRuleId: string | null;
    confidence: Confidence;
    sourceCount: number;
    openMarket: boolean;
    outcome: Outcome;
    reasonCode: string;
  }[] = [];

  for (const event of listMarketEvents(database)) {
    const revision = event.revisions.at(-1);
    if (!revision) continue;

    const newlyObservedEvidence = revision.evidence.filter((evidence) => {
      if (!availableSources.has(evidence.sourceKey)) return false;
      const watermark = input.previousWatermarks.get(evidence.sourceKey);
      return (
        watermark !== undefined &&
        safeNumber(evidence.collectedAtMs) > watermark
      );
    });
    const baselineEvidence = revision.evidence.filter(
      (evidence) =>
        baselineSourceSet.has(evidence.sourceKey) &&
        safeNumber(evidence.collectedAtMs) <= input.asOfMs,
    );
    if (newlyObservedEvidence.length === 0 && baselineEvidence.length === 0)
      continue;

    const ruleId = importanceRuleId(revision.importanceReason);
    const verifiedSources = new Set(
      revision.evidence
        .filter(
          (evidence) =>
            evidence.relation === "SUPPORTS" &&
            evidence.sourceLicenseStatus === "VERIFIED" &&
            TRUSTED_PRIMARY_ROLES.has(evidence.authorityRole),
        )
        .map(({ sourceKey }) => sourceKey),
    );
    const sourceCount = verifiedSources.size;
    const confidence: Confidence =
      sourceCount >= 2 ? "HIGH" : sourceCount === 1 ? "MEDIUM" : "LOW";
    const marketCode =
      revision.marketCode === "JP" || revision.marketCode === "US"
        ? revision.marketCode
        : null;
    const openMarket =
      marketCode !== null && input.openMarkets.includes(marketCode);
    const previousRevision = event.revisions.at(-2);
    let reasonCode: string | null = null;
    let outcome: Outcome = "SUPPRESSED";

    if (newlyObservedEvidence.length === 0) {
      outcome = "BASELINED";
      reasonCode = "FIRST_SCAN_BASELINE";
    } else if (
      revision.verificationLevel !== "VERIFIED" ||
      revision.dataClass !== "REAL"
    ) {
      reasonCode = "EVENT_NOT_VERIFIED";
    } else if (
      revision.evidence.some(({ relation }) => relation === "CONTRADICTS")
    ) {
      reasonCode = "EVIDENCE_CONFLICT";
    } else if (sourceCount === 0) {
      reasonCode = "SOURCE_NOT_AUTHORIZED";
    } else if (!ruleId) {
      reasonCode = "IMPORTANCE_NOT_RULED";
    } else if (
      previousRevision &&
      importanceRuleId(previousRevision.importanceReason) === ruleId
    ) {
      reasonCode = "NON_MAJOR_REVISION";
    } else if (
      !newlyObservedEvidence.some((evidence) => {
        const watermark = input.previousWatermarks.get(evidence.sourceKey);
        const publishedAtMs =
          evidence.publishedAtMs === null
            ? null
            : safeNumber(evidence.publishedAtMs);
        return (
          watermark !== undefined &&
          publishedAtMs !== null &&
          publishedAtMs > watermark &&
          publishedAtMs <= input.asOfMs
        );
      })
    ) {
      reasonCode = "LATE_OR_UNDATED";
    }

    candidates.push({
      eventId: event.id,
      revisionId: revision.id,
      marketCode,
      publishedAtMs:
        revision.publishedAtMs === null
          ? null
          : safeNumber(revision.publishedAtMs),
      importanceRuleId: ruleId,
      confidence,
      sourceCount,
      openMarket,
      outcome,
      reasonCode: reasonCode ?? "NEW_MAJOR_EVENT",
    });
  }

  const eligible = candidates
    .filter(({ reasonCode }) => reasonCode === "NEW_MAJOR_EVENT")
    .sort(
      (left, right) =>
        Number(right.openMarket) - Number(left.openMarket) ||
        right.sourceCount - left.sourceCount ||
        (right.publishedAtMs ?? 0) - (left.publishedAtMs ?? 0) ||
        left.eventId.localeCompare(right.eventId),
    );
  const ranks = new Map(
    eligible.map((candidate, index) => [candidate.revisionId, index + 1]),
  );
  const notifiedRevisionIds = new Set(
    database.orm
      .select({ revisionId: notifications.revisionId })
      .from(notifications)
      .all()
      .map(({ revisionId }) => revisionId),
  );

  for (const candidate of eligible) {
    if (notifiedRevisionIds.has(candidate.revisionId)) {
      candidate.outcome = "ALREADY_NOTIFIED";
      candidate.reasonCode = "ALREADY_NOTIFIED";
    } else if (ranks.get(candidate.revisionId)! <= NOTIFICATION_LIMIT) {
      candidate.outcome = "SELECTED";
    } else {
      candidate.outcome = "DEFERRED_LIMIT";
      candidate.reasonCode = "LIMIT_EXCEEDED";
    }
  }

  const insertDecision = database.client.prepare(
    `INSERT INTO notification_decisions
      (id, task_run_id, event_id, revision_id, outcome, reason_code,
       rule_version, importance_rule_id, confidence_level,
       supporting_source_count, priority_rank, priority_details_json, decided_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_run_id, revision_id) DO NOTHING`,
  );
  const hasDecision = database.client.prepare(
    "SELECT 1 FROM notification_decisions WHERE task_run_id = ? AND revision_id = ?",
  );
  const hasNotification = database.client.prepare(
    "SELECT 1 FROM notifications WHERE event_id = ? AND revision_id = ?",
  );
  const insertNotification = database.client.prepare(
    `INSERT INTO notifications
      (id, decision_id, event_id, revision_id, task_run_id, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updateWatermark = database.client.prepare(
    `INSERT INTO market_watch_source_watermarks (source_key, last_success_at_ms)
     VALUES (?, ?)
     ON CONFLICT(source_key) DO UPDATE SET last_success_at_ms = excluded.last_success_at_ms
     WHERE excluded.last_success_at_ms > market_watch_source_watermarks.last_success_at_ms`,
  );
  let notificationCount = 0;
  let decisionCount = 0;

  database.client
    .transaction(() => {
      for (const candidate of candidates) {
        if (hasDecision.get(input.taskRunId, candidate.revisionId)) continue;

        if (
          candidate.outcome === "SELECTED" &&
          hasNotification.get(candidate.eventId, candidate.revisionId)
        ) {
          candidate.outcome = "ALREADY_NOTIFIED";
          candidate.reasonCode = "ALREADY_NOTIFIED";
        }

        const decisionId = randomUUID();
        const priorityRank = ranks.get(candidate.revisionId) ?? null;
        const priorityDetails = {
          // shortcut: paper plans have no persisted event-trigger link; add this priority when that relation exists.
          directPaperRiskTrigger: false,
          openMarket: candidate.openMarket,
          supportingSourceCount: candidate.sourceCount,
          publishedAtMs: candidate.publishedAtMs,
        };
        const result = insertDecision.run(
          decisionId,
          input.taskRunId,
          candidate.eventId,
          candidate.revisionId,
          candidate.outcome,
          candidate.reasonCode,
          RULE_VERSION,
          candidate.importanceRuleId,
          candidate.confidence,
          candidate.sourceCount,
          priorityRank,
          JSON.stringify(priorityDetails),
          input.asOfMs,
        );
        if (result.changes === 0) continue;
        decisionCount += 1;

        if (candidate.outcome === "SELECTED") {
          insertNotification.run(
            randomUUID(),
            decisionId,
            candidate.eventId,
            candidate.revisionId,
            input.taskRunId,
            input.asOfMs,
          );
          notifiedRevisionIds.add(candidate.revisionId);
          notificationCount += 1;
        }
      }

      for (const sourceKey of availableSources) {
        updateWatermark.run(sourceKey, input.asOfMs);
      }
    })
    .immediate();

  return {
    notificationCount,
    decisionCount,
    baselineSourceKeys: baselineSources,
    allConfiguredFeedsAvailable: MARKET_WATCH_SOURCE_KEYS.every((sourceKey) =>
      availableSources.has(sourceKey),
    ),
    decisions: candidates.map(
      ({ eventId, revisionId, outcome, reasonCode }) => ({
        eventId,
        revisionId,
        outcome,
        reasonCode,
      }),
    ),
  };
}

export function listNotifications(database: AppDatabase, limit = 50) {
  const rows = database.client
    .prepare(
      `SELECT n.id, n.event_id, n.revision_id, n.task_run_id, n.created_at_ms,
              r.category, r.summary, r.market_code, r.published_at_ms,
              r.importance_reason, d.importance_rule_id, d.confidence_level,
              d.supporting_source_count
       FROM notifications n
       INNER JOIN market_event_revisions r ON r.id = n.revision_id
       INNER JOIN notification_decisions d ON d.id = n.decision_id
       ORDER BY n.created_at_ms DESC, n.id DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    event_id: string;
    revision_id: string;
    task_run_id: string;
    created_at_ms: bigint | number;
    category: string;
    summary: string;
    market_code: string | null;
    published_at_ms: bigint | number | null;
    importance_reason: string;
    importance_rule_id: string | null;
    confidence_level: string | null;
    supporting_source_count: bigint | number;
  }[];

  const evidenceByRevision = listEvidenceByRevision(
    database,
    rows.map(({ revision_id }) => revision_id),
  );

  return rows.map((row) => ({
    ...row,
    created_at_ms: safeNumber(row.created_at_ms as bigint | number),
    published_at_ms:
      row.published_at_ms === null
        ? null
        : safeNumber(row.published_at_ms as bigint | number),
    supporting_source_count: safeNumber(
      row.supporting_source_count as bigint | number,
    ),
    sources: evidenceByRevision.get(row.revision_id) ?? [],
  }));
}

function listEvidenceByRevision(database: AppDatabase, revisionIds: string[]) {
  if (revisionIds.length === 0) return new Map();

  const placeholders = revisionIds.map(() => "?").join(", ");
  const rows = database.client
    .prepare(
      `SELECT e.revision_id, e.relation, sr.id AS source_record_id,
              sr.canonical_url, sr.published_at_ms,
              sr.collected_at_ms, s.source_key, s.publisher,
              s.authority_role, s.license_status
       FROM market_event_evidence e
       INNER JOIN source_records sr ON sr.id = e.source_record_id
       INNER JOIN sources s ON s.id = sr.source_id
       WHERE e.revision_id IN (${placeholders})
       ORDER BY s.publisher COLLATE NOCASE, sr.published_at_ms DESC, sr.id ASC`,
    )
    .all(...revisionIds) as {
    revision_id: string;
    relation: string;
    source_record_id: string;
    canonical_url: string | null;
    published_at_ms: bigint | number | null;
    collected_at_ms: bigint | number;
    source_key: string;
    publisher: string;
    authority_role: string;
    license_status: string;
  }[];
  const evidenceByRevision = new Map<string, AlertEvidence[]>();

  for (const row of rows) {
    const evidence = {
      ...row,
      published_at_ms:
        row.published_at_ms === null ? null : safeNumber(row.published_at_ms),
      collected_at_ms: safeNumber(row.collected_at_ms),
    };
    const evidenceRows = evidenceByRevision.get(row.revision_id) ?? [];
    evidenceRows.push(evidence);
    evidenceByRevision.set(row.revision_id, evidenceRows);
  }

  return evidenceByRevision;
}

export function listNotificationDecisions(database: AppDatabase, limit = 100) {
  const rows = database.client
    .prepare(
      `SELECT d.id, d.task_run_id, d.event_id, d.revision_id, d.outcome,
              d.reason_code, d.rule_version, d.importance_rule_id,
              d.confidence_level, d.supporting_source_count, d.priority_rank,
              CAST(json_extract(d.priority_details_json, '$.openMarket') AS INTEGER) AS open_market_priority,
              CAST(json_extract(d.priority_details_json, '$.supportingSourceCount') AS INTEGER) AS priority_source_count,
              CAST(json_extract(d.priority_details_json, '$.publishedAtMs') AS INTEGER) AS priority_published_at_ms,
              d.priority_details_json, d.decided_at_ms, r.summary, r.market_code
       FROM notification_decisions d
       INNER JOIN market_event_revisions r ON r.id = d.revision_id
       ORDER BY d.decided_at_ms DESC, d.id DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    task_run_id: string;
    event_id: string;
    revision_id: string;
    outcome: string;
    reason_code: string;
    rule_version: string;
    importance_rule_id: string | null;
    confidence_level: string | null;
    supporting_source_count: bigint | number | null;
    priority_rank: bigint | number | null;
    open_market_priority: bigint | number | null;
    priority_source_count: bigint | number | null;
    priority_published_at_ms: bigint | number | null;
    priority_details_json: string;
    decided_at_ms: bigint | number;
    summary: string;
    market_code: string | null;
  }[];
  const evidenceByRevision = listEvidenceByRevision(
    database,
    rows.map(({ revision_id }) => revision_id),
  );

  return rows.map((row) => ({
    ...row,
    supporting_source_count:
      row.supporting_source_count === null
        ? null
        : safeNumber(row.supporting_source_count as bigint | number),
    priority_rank:
      row.priority_rank === null
        ? null
        : safeNumber(row.priority_rank as bigint | number),
    open_market_priority:
      row.open_market_priority === null
        ? null
        : safeNumber(row.open_market_priority as bigint | number),
    priority_source_count:
      row.priority_source_count === null
        ? null
        : safeNumber(row.priority_source_count as bigint | number),
    priority_published_at_ms:
      row.priority_published_at_ms === null
        ? null
        : safeNumber(row.priority_published_at_ms as bigint | number),
    decided_at_ms: safeNumber(row.decided_at_ms as bigint | number),
    sources: evidenceByRevision.get(row.revision_id) ?? [],
  }));
}
