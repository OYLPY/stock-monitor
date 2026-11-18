import { createHash, randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { instrumentCompositeKey } from "../../domain/primitives.ts";
import { type AppDatabase, withTransaction } from "../../db/index.ts";
import {
  auditEvents,
  marketEventEvidence,
  marketEventRevisions,
  marketEvents,
  sourceRecords,
  sources,
} from "../../db/schema.ts";

const sourceRoleSchema = z.enum([
  "REGULATORY_PRIMARY",
  "EXCHANGE_PRIMARY",
  "ISSUER_PRIMARY",
  "AUTHORIZED_VENDOR",
  "SECONDARY",
  "FIXTURE",
  "UNKNOWN",
]);
const dataClassSchema = z.enum([
  "REAL",
  "DELAYED",
  "HISTORICAL",
  "FIXTURE",
  "NOT_VERIFIED",
]);
const verificationLevelSchema = z.enum([
  "VERIFIED",
  "PARTIAL",
  "NOT_VERIFIED",
  "DEMO_ONLY",
]);
const referenceUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "unsafe_reference_url");
const nullableTimestampSchema = z.number().int().safe().nullable();

const sourceInputSchema = z.strictObject({
  sourceKey: z.string().regex(/^[a-z][a-z0-9._-]{0,119}$/),
  publisher: z.string().trim().min(1).max(160),
  sourceType: z.enum([
    "REGULATORY",
    "EXCHANGE",
    "ISSUER",
    "NEWS",
    "DATA_VENDOR",
    "OTHER",
  ]),
  authorityRole: sourceRoleSchema,
  referenceUrl: referenceUrlSchema.nullable(),
  licenseUrl: referenceUrlSchema.nullable(),
  licenseStatus: z.enum(["VERIFIED", "NOT_VERIFIED", "UNKNOWN"]),
  credentialRequirement: z.enum(["REQUIRED", "NOT_REQUIRED", "UNKNOWN"]),
});

const sourceRecordInputSchema = z.strictObject({
  sourceId: z.string().uuid(),
  recordKey: z.string().trim().min(1).max(256),
  recordType: z.enum(["MARKET_QUOTE", "DISCLOSURE", "NEWS", "OTHER"]),
  recordVersion: z.number().int().min(1).max(2_147_483_647),
  supersedesRecordId: z.string().uuid().nullable(),
  publishedAtMs: nullableTimestampSchema,
  occurredAtMs: nullableTimestampSchema,
  availableAtMs: nullableTimestampSchema,
  rawTimeText: z.string().max(200).nullable(),
  sourceTimeZone: z.string().max(64).nullable(),
  canonicalUrl: referenceUrlSchema.nullable(),
  dataClass: dataClassSchema,
  content: z.union([z.string(), z.instanceof(Uint8Array)]),
});

const eventEvidenceSchema = z.strictObject({
  sourceRecordId: z.string().uuid(),
  relation: z.enum(["SUPPORTS", "CONTRADICTS", "CONTEXT"]),
});

const instrumentSchema = z.strictObject({
  market: z.enum(["JP", "US"]),
  exchangeCode: z.string().min(1).max(32),
  symbol: z.string().min(1).max(64),
});

const eventRevisionInputSchema = z
  .strictObject({
    category: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    summary: z.string().trim().min(1).max(1000),
    marketCode: z.enum(["JP", "US"]).nullable(),
    instrument: instrumentSchema.nullable(),
    occurredAtMs: nullableTimestampSchema,
    publishedAtMs: nullableTimestampSchema,
    importanceReason: z.string().trim().min(1).max(2000),
    dataClass: dataClassSchema,
    verificationLevel: verificationLevelSchema,
    verificationReason: z.string().trim().max(500).nullable(),
    verificationRuleVersion: z.string().trim().min(1).max(120).nullable(),
    primarySourceRecordId: z.string().uuid().nullable(),
    evidence: z.array(eventEvidenceSchema).max(100),
  })
  .superRefine((value, context) => {
    const sourceIds = new Set(
      value.evidence.map(({ sourceRecordId }) => sourceRecordId),
    );
    if (
      value.primarySourceRecordId &&
      !sourceIds.has(value.primarySourceRecordId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["primarySourceRecordId"],
        message: "primary_source_must_be_linked",
      });
    }
    if (
      (value.verificationLevel === "VERIFIED" ||
        value.verificationLevel === "PARTIAL") &&
      value.evidence.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "evidence_required_for_verification_level",
      });
    }
    if (
      value.verificationLevel === "VERIFIED" &&
      (!value.primarySourceRecordId || !value.verificationRuleVersion)
    ) {
      context.addIssue({
        code: "custom",
        path: ["verificationLevel"],
        message: "verified_requires_source_and_rule",
      });
    }
    if (
      value.verificationLevel === "NOT_VERIFIED" &&
      value.evidence.length === 0 &&
      !value.verificationReason
    ) {
      context.addIssue({
        code: "custom",
        path: ["verificationReason"],
        message: "missing_source_reason_required",
      });
    }
    if (
      value.dataClass === "FIXTURE" &&
      value.verificationLevel !== "DEMO_ONLY"
    ) {
      context.addIssue({
        code: "custom",
        path: ["verificationLevel"],
        message: "fixture_must_be_demo_only",
      });
    }
    if (
      value.instrument &&
      value.marketCode &&
      value.instrument.market !== value.marketCode
    ) {
      context.addIssue({
        code: "custom",
        path: ["instrument", "market"],
        message: "instrument_market_mismatch",
      });
    }
  });

export type SourceInput = z.input<typeof sourceInputSchema>;
export type SourceRecordInput = z.input<typeof sourceRecordInputSchema>;
export type MarketEventRevisionInput = z.input<typeof eventRevisionInputSchema>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function auditEventHash(input: {
  sequenceNo: bigint;
  entityType: string;
  entityId: string;
  action: string;
  payloadHashSha256: string;
  previousHashSha256: string | null;
  recordedAtMs: bigint;
}): string {
  return sha256(
    JSON.stringify([
      input.sequenceNo.toString(),
      input.entityType,
      input.entityId,
      input.action,
      input.payloadHashSha256,
      input.previousHashSha256,
      input.recordedAtMs.toString(),
    ]),
  );
}

function appendAuditEvent(
  database: AppDatabase,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    payload: unknown;
  },
) {
  const previous = database.orm
    .select({
      sequenceNo: auditEvents.sequenceNo,
      eventHashSha256: auditEvents.eventHashSha256,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.sequenceNo))
    .limit(1)
    .get();
  const sequenceNo = (previous?.sequenceNo ?? BigInt(0)) + BigInt(1);
  const recordedAtMs = BigInt(Date.now());
  const payloadHashSha256 = sha256(JSON.stringify(input.payload));
  const previousHashSha256 = previous?.eventHashSha256 ?? null;
  const eventHashSha256 = auditEventHash({
    sequenceNo,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    payloadHashSha256,
    previousHashSha256,
    recordedAtMs,
  });

  database.orm
    .insert(auditEvents)
    .values({
      id: randomUUID(),
      sequenceNo,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payloadHashSha256,
      previousHashSha256,
      eventHashSha256,
      recordedAtMs,
    })
    .run();
}

export function recordAuditEvent(
  database: AppDatabase,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    payload: unknown;
  },
): void {
  withTransaction(database, () => appendAuditEvent(database, input));
}

export function registerSource(database: AppDatabase, input: SourceInput) {
  const parsed = sourceInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_source_input");

  const source = {
    ...parsed.data,
    id: randomUUID(),
    registeredAtMs: BigInt(Date.now()),
  };

  withTransaction(database, () => {
    database.orm.insert(sources).values(source).run();
    appendAuditEvent(database, {
      entityType: "SOURCE",
      entityId: source.id,
      action: "REGISTERED",
      payload: {
        sourceKey: source.sourceKey,
        sourceType: source.sourceType,
        authorityRole: source.authorityRole,
        licenseStatus: source.licenseStatus,
      },
    });
  });

  return source;
}

export function appendSourceRecord(
  database: AppDatabase,
  input: SourceRecordInput,
) {
  const parsed = sourceRecordInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_source_record_input");

  const source = database.orm
    .select({ authorityRole: sources.authorityRole })
    .from(sources)
    .where(eq(sources.id, parsed.data.sourceId))
    .get();
  if (!source) throw new Error("source_not_found");
  if (
    (parsed.data.dataClass === "FIXTURE") !==
    (source.authorityRole === "FIXTURE")
  ) {
    throw new Error("source_record_class_mismatch");
  }

  const previous = parsed.data.supersedesRecordId
    ? database.orm
        .select({
          sourceId: sourceRecords.sourceId,
          recordKey: sourceRecords.recordKey,
          recordVersion: sourceRecords.recordVersion,
        })
        .from(sourceRecords)
        .where(eq(sourceRecords.id, parsed.data.supersedesRecordId))
        .get()
    : undefined;
  if (
    (parsed.data.recordVersion === 1 && parsed.data.supersedesRecordId) ||
    (parsed.data.recordVersion > 1 &&
      (!previous ||
        previous.sourceId !== parsed.data.sourceId ||
        previous.recordKey !== parsed.data.recordKey ||
        previous.recordVersion !== parsed.data.recordVersion - 1))
  ) {
    throw new Error("source_record_version_conflict");
  }

  const record = {
    id: randomUUID(),
    sourceId: parsed.data.sourceId,
    recordKey: parsed.data.recordKey,
    recordType: parsed.data.recordType,
    recordVersion: parsed.data.recordVersion,
    supersedesRecordId: parsed.data.supersedesRecordId,
    publishedAtMs:
      parsed.data.publishedAtMs === null
        ? null
        : BigInt(parsed.data.publishedAtMs),
    occurredAtMs:
      parsed.data.occurredAtMs === null
        ? null
        : BigInt(parsed.data.occurredAtMs),
    availableAtMs:
      parsed.data.availableAtMs === null
        ? null
        : BigInt(parsed.data.availableAtMs),
    collectedAtMs: BigInt(Date.now()),
    rawTimeText: parsed.data.rawTimeText,
    sourceTimeZone: parsed.data.sourceTimeZone,
    canonicalUrl: parsed.data.canonicalUrl,
    contentHashSha256: sha256(parsed.data.content),
    dataClass: parsed.data.dataClass,
  };

  withTransaction(database, () => {
    database.orm.insert(sourceRecords).values(record).run();
    appendAuditEvent(database, {
      entityType: "SOURCE_RECORD",
      entityId: record.id,
      action: "RECORDED",
      payload: {
        sourceId: record.sourceId,
        recordKey: record.recordKey,
        recordVersion: record.recordVersion,
        contentHashSha256: record.contentHashSha256,
        dataClass: record.dataClass,
        collectedAtMs: record.collectedAtMs.toString(),
      },
    });
  });

  return record;
}

function parseEventRevision(input: MarketEventRevisionInput) {
  const parsed = eventRevisionInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_market_event_revision");
  return parsed.data;
}

function insertEventRevision(
  database: AppDatabase,
  eventId: string,
  revisionNo: number,
  firstSeenAtMs: bigint,
  input: MarketEventRevisionInput,
) {
  const parsed = parseEventRevision(input);
  const evidenceIds = [
    ...new Set(parsed.evidence.map((item) => item.sourceRecordId)),
  ];
  if (evidenceIds.length !== parsed.evidence.length) {
    throw new Error("duplicate_market_event_evidence");
  }

  const evidenceRecords = evidenceIds.length
    ? database.orm
        .select({
          id: sourceRecords.id,
          dataClass: sourceRecords.dataClass,
          authorityRole: sources.authorityRole,
          licenseStatus: sources.licenseStatus,
        })
        .from(sourceRecords)
        .innerJoin(sources, eq(sourceRecords.sourceId, sources.id))
        .where(inArray(sourceRecords.id, evidenceIds))
        .all()
    : [];
  if (evidenceRecords.length !== evidenceIds.length) {
    throw new Error("source_record_not_found");
  }

  const hasFixtureEvidence = evidenceRecords.some(
    (record) => record.dataClass === "FIXTURE",
  );
  if (
    hasFixtureEvidence !== (parsed.dataClass === "FIXTURE") ||
    (hasFixtureEvidence && parsed.verificationLevel !== "DEMO_ONLY")
  ) {
    throw new Error("fixture_event_class_mismatch");
  }

  if (parsed.verificationLevel === "VERIFIED") {
    const primary = evidenceRecords.find(
      ({ id }) => id === parsed.primarySourceRecordId,
    );
    if (
      !primary ||
      ![
        "REGULATORY_PRIMARY",
        "EXCHANGE_PRIMARY",
        "ISSUER_PRIMARY",
        "AUTHORIZED_VENDOR",
      ].includes(primary.authorityRole) ||
      primary.licenseStatus !== "VERIFIED" ||
      primary.dataClass === "FIXTURE" ||
      primary.dataClass === "NOT_VERIFIED"
    ) {
      throw new Error("verified_event_requires_approved_evidence");
    }
  }

  const instrumentKey = parsed.instrument
    ? instrumentCompositeKey(parsed.instrument)
    : null;
  const marketCode = parsed.marketCode ?? parsed.instrument?.market ?? null;
  const fingerprintAlgorithmVersion = "sha256-canonical-v1";
  const fingerprintSha256 = sha256(
    JSON.stringify([
      fingerprintAlgorithmVersion,
      parsed.category,
      marketCode,
      instrumentKey,
      parsed.occurredAtMs,
      parsed.summary,
    ]),
  );
  const revision = {
    id: randomUUID(),
    eventId,
    revisionNo,
    category: parsed.category,
    summary: parsed.summary,
    marketCode,
    instrumentKey,
    occurredAtMs:
      parsed.occurredAtMs === null ? null : BigInt(parsed.occurredAtMs),
    publishedAtMs:
      parsed.publishedAtMs === null ? null : BigInt(parsed.publishedAtMs),
    firstSeenAtMs,
    importanceReason: parsed.importanceReason,
    dataClass: parsed.dataClass,
    verificationLevel: parsed.verificationLevel,
    verificationReason: parsed.verificationReason,
    verificationRuleVersion: parsed.verificationRuleVersion,
    primarySourceRecordId: parsed.primarySourceRecordId,
    fingerprintAlgorithmVersion,
    fingerprintSha256,
    recordedAtMs: BigInt(Date.now()),
  };

  database.orm.insert(marketEventRevisions).values(revision).run();
  for (const evidence of parsed.evidence) {
    database.orm
      .insert(marketEventEvidence)
      .values({
        revisionId: revision.id,
        sourceRecordId: evidence.sourceRecordId,
        relation: evidence.relation,
        linkedAtMs: BigInt(Date.now()),
      })
      .run();
    appendAuditEvent(database, {
      entityType: "MARKET_EVENT_EVIDENCE",
      entityId: `${revision.id}:${evidence.sourceRecordId}`,
      action: "LINKED",
      payload: evidence,
    });
  }
  appendAuditEvent(database, {
    entityType: "MARKET_EVENT_REVISION",
    entityId: revision.id,
    action: "APPENDED",
    payload: {
      eventId,
      revisionNo,
      fingerprintSha256,
      verificationLevel: revision.verificationLevel,
      evidenceRecordIds: evidenceIds,
    },
  });

  return revision;
}

export function createMarketEvent(
  database: AppDatabase,
  input: MarketEventRevisionInput,
) {
  const eventId = randomUUID();
  const createdAtMs = BigInt(Date.now());

  return withTransaction(database, () => {
    database.orm
      .insert(marketEvents)
      .values({ id: eventId, createdAtMs })
      .run();
    const revision = insertEventRevision(
      database,
      eventId,
      1,
      createdAtMs,
      input,
    );
    appendAuditEvent(database, {
      entityType: "MARKET_EVENT",
      entityId: eventId,
      action: "CREATED",
      payload: { firstRevisionId: revision.id },
    });
    return { id: eventId, createdAtMs, revisions: [revision] };
  });
}

export function appendMarketEventRevision(
  database: AppDatabase,
  eventId: string,
  input: MarketEventRevisionInput,
) {
  return withTransaction(database, () => {
    const previous = database.orm
      .select({
        revisionNo: marketEventRevisions.revisionNo,
        firstSeenAtMs: marketEventRevisions.firstSeenAtMs,
      })
      .from(marketEventRevisions)
      .where(eq(marketEventRevisions.eventId, eventId))
      .orderBy(desc(marketEventRevisions.revisionNo))
      .limit(1)
      .get();
    if (!previous) throw new Error("market_event_not_found");

    return insertEventRevision(
      database,
      eventId,
      previous.revisionNo + 1,
      previous.firstSeenAtMs,
      input,
    );
  });
}

export function getMarketEvent(database: AppDatabase, eventId: string) {
  const event = database.orm
    .select()
    .from(marketEvents)
    .where(eq(marketEvents.id, eventId))
    .get();
  if (!event) return null;

  const revisions = database.orm
    .select()
    .from(marketEventRevisions)
    .where(eq(marketEventRevisions.eventId, eventId))
    .orderBy(asc(marketEventRevisions.revisionNo))
    .all()
    .map((revision) => ({
      ...revision,
      evidence: database.orm
        .select({
          sourceRecordId: sourceRecords.id,
          recordKey: sourceRecords.recordKey,
          recordVersion: sourceRecords.recordVersion,
          recordType: sourceRecords.recordType,
          publishedAtMs: sourceRecords.publishedAtMs,
          occurredAtMs: sourceRecords.occurredAtMs,
          availableAtMs: sourceRecords.availableAtMs,
          collectedAtMs: sourceRecords.collectedAtMs,
          rawTimeText: sourceRecords.rawTimeText,
          sourceTimeZone: sourceRecords.sourceTimeZone,
          canonicalUrl: sourceRecords.canonicalUrl,
          contentHashSha256: sourceRecords.contentHashSha256,
          dataClass: sourceRecords.dataClass,
          relation: marketEventEvidence.relation,
          linkedAtMs: marketEventEvidence.linkedAtMs,
          sourceId: sources.id,
          sourceKey: sources.sourceKey,
          publisher: sources.publisher,
          authorityRole: sources.authorityRole,
          sourceReferenceUrl: sources.referenceUrl,
          sourceLicenseStatus: sources.licenseStatus,
        })
        .from(marketEventEvidence)
        .innerJoin(
          sourceRecords,
          eq(marketEventEvidence.sourceRecordId, sourceRecords.id),
        )
        .innerJoin(sources, eq(sourceRecords.sourceId, sources.id))
        .where(eq(marketEventEvidence.revisionId, revision.id))
        .orderBy(asc(sourceRecords.recordKey))
        .all(),
    }));

  return { ...event, revisions };
}

export function listMarketEvents(database: AppDatabase) {
  return database.orm
    .select({ id: marketEvents.id })
    .from(marketEvents)
    .orderBy(desc(marketEvents.createdAtMs), asc(marketEvents.id))
    .all()
    .flatMap(({ id }) => {
      const event = getMarketEvent(database, id);
      return event ? [event] : [];
    });
}

export function listAuditEvents(database: AppDatabase) {
  return database.orm
    .select()
    .from(auditEvents)
    .orderBy(asc(auditEvents.sequenceNo))
    .all();
}

export function verifyAuditTrail(database: AppDatabase): boolean {
  let sequenceNo = BigInt(1);
  let previousHashSha256: string | null = null;

  for (const event of listAuditEvents(database)) {
    if (
      event.sequenceNo !== sequenceNo ||
      event.previousHashSha256 !== previousHashSha256 ||
      event.eventHashSha256 !== auditEventHash(event)
    ) {
      return false;
    }
    sequenceNo += BigInt(1);
    previousHashSha256 = event.eventHashSha256;
  }

  return true;
}
