import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db";
import {
  auditEvents,
  marketEventEvidence,
  marketEventRevisions,
  marketEvents,
  sourceRecords,
  sources,
} from "../../db/schema";
import { createTestDatabase } from "../../db/test-database";
import {
  appendMarketEventRevision,
  appendSourceRecord,
  createMarketEvent,
  getMarketEvent,
  listAuditEvents,
  registerSource,
  verifyAuditTrail,
} from "./repository";

function fixtureSourceInput() {
  return {
    sourceKey: "test.fixture",
    publisher: "Synthetic test fixture",
    sourceType: "OTHER" as const,
    authorityRole: "FIXTURE" as const,
    referenceUrl: null,
    licenseUrl: null,
    licenseStatus: "UNKNOWN" as const,
    credentialRequirement: "NOT_REQUIRED" as const,
  };
}

function sourceRecordInput(
  sourceId: string,
  overrides: Partial<{
    recordKey: string;
    recordVersion: number;
    supersedesRecordId: string | null;
    dataClass: "FIXTURE" | "NOT_VERIFIED";
    content: string;
  }> = {},
) {
  return {
    sourceId,
    recordKey: "quote:7203:2026-11-16",
    recordType: "MARKET_QUOTE" as const,
    recordVersion: 1,
    supersedesRecordId: null,
    publishedAtMs: null,
    occurredAtMs: 1_794_096_000_000,
    availableAtMs: null,
    rawTimeText: "2026-11-16",
    sourceTimeZone: "Asia/Tokyo",
    canonicalUrl: null,
    dataClass: "FIXTURE" as const,
    content: "synthetic quote fixture v1",
    ...overrides,
  };
}

function eventInput(sourceRecordId?: string) {
  return {
    category: "QUOTE_SAMPLE",
    summary: "Synthetic quote evidence",
    marketCode: "JP" as const,
    instrument: {
      market: "JP" as const,
      exchangeCode: "XTKS",
      symbol: "7203",
    },
    occurredAtMs: 1_794_096_000_000,
    publishedAtMs: null,
    importanceReason: "Fixture used to verify evidence persistence.",
    dataClass: "FIXTURE" as const,
    verificationLevel: "DEMO_ONLY" as const,
    verificationReason: "Synthetic test fixture.",
    verificationRuleVersion: null,
    primarySourceRecordId: null,
    evidence: sourceRecordId
      ? [{ sourceRecordId, relation: "SUPPORTS" as const }]
      : [],
  };
}

describe("evidence repository", () => {
  it("persists quote references, event revisions, hashes, and audit history across restart", async () => {
    const fixture = await createTestDatabase();
    try {
      const source = registerSource(fixture.database, fixtureSourceInput());
      const firstRecord = appendSourceRecord(
        fixture.database,
        sourceRecordInput(source.id),
      );
      const secondRecord = appendSourceRecord(
        fixture.database,
        sourceRecordInput(source.id, {
          recordVersion: 2,
          supersedesRecordId: firstRecord.id,
          content: "synthetic quote fixture v2",
        }),
      );
      const event = createMarketEvent(
        fixture.database,
        eventInput(secondRecord.id),
      );
      appendMarketEventRevision(
        fixture.database,
        event.id,
        eventInput(secondRecord.id),
      );

      expect(secondRecord.contentHashSha256).toBe(
        createHash("sha256").update("synthetic quote fixture v2").digest("hex"),
      );
      expect(() =>
        appendSourceRecord(
          fixture.database,
          sourceRecordInput(source.id, {
            recordVersion: 2,
            supersedesRecordId: firstRecord.id,
            content: "duplicate version",
          }),
        ),
      ).toThrow();
      expect(() =>
        appendSourceRecord(
          fixture.database,
          sourceRecordInput(source.id, {
            recordVersion: 3,
            supersedesRecordId: firstRecord.id,
          }),
        ),
      ).toThrow("source_record_version_conflict");
      expect(verifyAuditTrail(fixture.database)).toBe(true);

      fixture.database.client.close();
      const restarted = await openDatabase(fixture.filePath);
      try {
        const persisted = getMarketEvent(restarted, event.id);
        expect(persisted?.revisions).toHaveLength(2);
        expect(persisted?.revisions[0]?.firstSeenAtMs).toBe(
          persisted?.revisions[1]?.firstSeenAtMs,
        );
        expect(persisted?.revisions[1]?.verificationLevel).toBe("DEMO_ONLY");
        expect(persisted?.revisions[1]?.evidence).toMatchObject([
          {
            sourceRecordId: secondRecord.id,
            recordVersion: 2,
            occurredAtMs: BigInt(1_794_096_000_000),
            collectedAtMs: secondRecord.collectedAtMs,
            sourceTimeZone: "Asia/Tokyo",
            canonicalUrl: null,
            contentHashSha256: secondRecord.contentHashSha256,
            dataClass: "FIXTURE",
            sourceKey: source.sourceKey,
          },
        ]);
        expect(restarted.orm.select().from(sourceRecords).all()).toHaveLength(
          2,
        );
        expect(listAuditEvents(restarted)).toHaveLength(8);
        expect(verifyAuditTrail(restarted)).toBe(true);
      } finally {
        restarted.client.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps missing or untrusted evidence explicitly unverified", async () => {
    const fixture = await createTestDatabase();
    try {
      expect(() =>
        createMarketEvent(fixture.database, {
          ...eventInput(),
          dataClass: "NOT_VERIFIED",
          verificationLevel: "VERIFIED",
          verificationReason: null,
          verificationRuleVersion: "test-rule-v1",
        }),
      ).toThrow("invalid_market_event_revision");

      const unknownSource = registerSource(fixture.database, {
        ...fixtureSourceInput(),
        sourceKey: "test.unknown",
        authorityRole: "UNKNOWN",
        credentialRequirement: "UNKNOWN",
      });
      const unverifiedRecord = appendSourceRecord(
        fixture.database,
        sourceRecordInput(unknownSource.id, { dataClass: "NOT_VERIFIED" }),
      );
      expect(() =>
        createMarketEvent(fixture.database, {
          ...eventInput(unverifiedRecord.id),
          dataClass: "NOT_VERIFIED",
          verificationLevel: "VERIFIED",
          verificationReason: null,
          verificationRuleVersion: "test-rule-v1",
          primarySourceRecordId: unverifiedRecord.id,
        }),
      ).toThrow("verified_event_requires_approved_evidence");

      const fixtureSource = registerSource(
        fixture.database,
        fixtureSourceInput(),
      );
      const fixtureRecord = appendSourceRecord(
        fixture.database,
        sourceRecordInput(fixtureSource.id),
      );
      expect(() =>
        createMarketEvent(fixture.database, {
          ...eventInput(fixtureRecord.id),
          verificationLevel: "VERIFIED",
          verificationReason: null,
          verificationRuleVersion: "test-rule-v1",
          primarySourceRecordId: fixtureRecord.id,
        }),
      ).toThrow("invalid_market_event_revision");

      const event = createMarketEvent(fixture.database, {
        ...eventInput(),
        dataClass: "NOT_VERIFIED",
        verificationLevel: "NOT_VERIFIED",
        verificationReason: "No authoritative source record is available.",
      });
      expect(
        getMarketEvent(fixture.database, event.id)?.revisions[0],
      ).toMatchObject({
        verificationLevel: "NOT_VERIFIED",
        verificationReason: "No authoritative source record is available.",
        primarySourceRecordId: null,
      });
      expect(
        fixture.database.orm.select().from(marketEvents).all(),
      ).toHaveLength(1);
      expect(verifyAuditTrail(fixture.database)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects updates and deletes to sources, records, revisions, evidence, and audit entries", async () => {
    const fixture = await createTestDatabase();
    try {
      const source = registerSource(fixture.database, fixtureSourceInput());
      const record = appendSourceRecord(
        fixture.database,
        sourceRecordInput(source.id),
      );
      const event = createMarketEvent(fixture.database, eventInput(record.id));
      const revision = event.revisions[0];
      const evidence = fixture.database.orm
        .select()
        .from(marketEventEvidence)
        .get();
      const audit = fixture.database.orm.select().from(auditEvents).get();

      expect(revision).toBeDefined();
      expect(evidence).toBeDefined();
      expect(audit).toBeDefined();
      expect(() =>
        fixture.database.orm
          .update(sources)
          .set({ publisher: "Changed publisher" })
          .where(eq(sources.id, source.id))
          .run(),
      ).toThrow("sources are immutable");
      expect(() =>
        fixture.database.orm
          .delete(sources)
          .where(eq(sources.id, source.id))
          .run(),
      ).toThrow("sources are immutable");
      expect(() =>
        fixture.database.orm
          .update(sourceRecords)
          .set({ canonicalUrl: "https://example.test/changed" })
          .where(eq(sourceRecords.id, record.id))
          .run(),
      ).toThrow("source_records are append-only");
      expect(() =>
        fixture.database.orm
          .delete(sourceRecords)
          .where(eq(sourceRecords.id, record.id))
          .run(),
      ).toThrow("source_records are append-only");
      expect(() =>
        fixture.database.orm
          .update(marketEvents)
          .set({ createdAtMs: BigInt(1) })
          .where(eq(marketEvents.id, event.id))
          .run(),
      ).toThrow("market_events are immutable");
      expect(() =>
        fixture.database.orm
          .delete(marketEvents)
          .where(eq(marketEvents.id, event.id))
          .run(),
      ).toThrow("market_events are immutable");
      expect(() =>
        fixture.database.orm
          .update(marketEventRevisions)
          .set({ summary: "Changed summary" })
          .where(eq(marketEventRevisions.id, revision!.id))
          .run(),
      ).toThrow("market_event_revisions are append-only");
      expect(() =>
        fixture.database.orm
          .delete(marketEventRevisions)
          .where(eq(marketEventRevisions.id, revision!.id))
          .run(),
      ).toThrow("market_event_revisions are append-only");
      expect(() =>
        fixture.database.orm
          .update(marketEventEvidence)
          .set({ relation: "CONTEXT" })
          .where(eq(marketEventEvidence.revisionId, evidence!.revisionId))
          .run(),
      ).toThrow("market_event_evidence are append-only");
      expect(() =>
        fixture.database.orm
          .delete(marketEventEvidence)
          .where(eq(marketEventEvidence.revisionId, evidence!.revisionId))
          .run(),
      ).toThrow("market_event_evidence are append-only");
      expect(() =>
        fixture.database.orm
          .update(auditEvents)
          .set({ action: "ALTERED" })
          .where(eq(auditEvents.id, audit!.id))
          .run(),
      ).toThrow("audit_events are append-only");
      expect(() =>
        fixture.database.orm
          .delete(auditEvents)
          .where(eq(auditEvents.id, audit!.id))
          .run(),
      ).toThrow("audit_events are append-only");
      expect(verifyAuditTrail(fixture.database)).toBe(true);
      fixture.database.client.exec("DROP TRIGGER audit_events_no_update");
      fixture.database.client
        .prepare("UPDATE audit_events SET action = 'ALTERED' WHERE id = ?")
        .run(audit!.id);
      expect(verifyAuditTrail(fixture.database)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
