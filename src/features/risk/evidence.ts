import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "@/db";
import { sourceRecords, sources } from "@/db/schema";

export const sourceEvidenceInputSchema = z.strictObject({
  sourceRecordId: z.uuid(),
  content: z.string().min(1).max(16_384),
});

export const evidenceInputSchema = sourceEvidenceInputSchema.nullable();

const trustedRoles = new Set([
  "REGULATORY_PRIMARY",
  "EXCHANGE_PRIMARY",
  "ISSUER_PRIMARY",
  "AUTHORIZED_VENDOR",
]);

export function isTrustedSourceRole(role: string) {
  return trustedRoles.has(role);
}

export function getSourceEvidence(
  database: AppDatabase,
  evidence: z.infer<typeof sourceEvidenceInputSchema> | null,
  recordTypes: string[],
  asOfMs: bigint,
  allowHistorical = false,
) {
  if (!evidence) return { reasonCode: "EVIDENCE_UNAVAILABLE" } as const;
  const record = database.orm
    .select({
      id: sourceRecords.id,
      recordType: sourceRecords.recordType,
      dataClass: sourceRecords.dataClass,
      contentHashSha256: sourceRecords.contentHashSha256,
      occurredAtMs: sourceRecords.occurredAtMs,
      collectedAtMs: sourceRecords.collectedAtMs,
      authorityRole: sources.authorityRole,
      licenseStatus: sources.licenseStatus,
    })
    .from(sourceRecords)
    .innerJoin(sources, eq(sources.id, sourceRecords.sourceId))
    .where(eq(sourceRecords.id, evidence.sourceRecordId))
    .get();
  if (!record) return { reasonCode: "EVIDENCE_UNAVAILABLE" } as const;
  if (record.dataClass === "FIXTURE" || record.authorityRole === "FIXTURE") {
    return { reasonCode: "FIXTURE_EVIDENCE" } as const;
  }
  if (
    !recordTypes.includes(record.recordType) ||
    record.licenseStatus !== "VERIFIED" ||
    !isTrustedSourceRole(record.authorityRole) ||
    (record.dataClass !== "REAL" &&
      record.dataClass !== "DELAYED" &&
      !(allowHistorical && record.dataClass === "HISTORICAL")) ||
    record.collectedAtMs > asOfMs ||
    (record.occurredAtMs !== null && record.occurredAtMs > asOfMs)
  ) {
    return { reasonCode: "EVIDENCE_SOURCE_UNVERIFIED" } as const;
  }
  if (
    createHash("sha256").update(evidence.content).digest("hex") !==
    record.contentHashSha256
  ) {
    return { reasonCode: "EVIDENCE_HASH_MISMATCH" } as const;
  }
  const successor = database.orm
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(eq(sourceRecords.supersedesRecordId, record.id))
    .limit(1)
    .get();
  if (successor) return { reasonCode: "EVIDENCE_SUPERSEDED" } as const;
  return { record } as const;
}
