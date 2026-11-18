import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/db/test-database";
import { paperAccounts } from "@/db/schema";
import { runCodexTask } from "@/features/ai/codex-adapter";
import {
  appendSourceRecord,
  createMarketEvent,
  registerSource,
} from "@/features/evidence/repository";
import { runResearchReportWorkflow } from "./report";

vi.mock("@/features/ai/codex-adapter", () => ({
  runCodexTask: vi.fn(),
}));

const fixtures: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  vi.clearAllMocks();
});

describe("runResearchReportWorkflow", () => {
  it("archives an unverified report without candidates when local evidence is absent", async () => {
    const fixture = await createTestDatabase();
    fixtures.push(fixture);

    const report = await runResearchReportWorkflow({
      database: fixture.database,
      taskRunId: "5f6d7e10-dba1-452b-a4f3-6aa541c8fa83",
      type: "MORNING",
      signal: new AbortController().signal,
      nowMs: Date.UTC(2026, 10, 18),
    });

    expect(report.verificationLevel).toBe("NOT_VERIFIED");
    expect(report.resultCode).toBe("NO_SAVED_EVIDENCE");
    expect(report.candidates).toEqual([]);
    expect(report.roleAudit.strategyResearch.status).toBe("SKIPPED");
    expect(report.roleAudit.paperPlanner.status).toBe("SKIPPED");
    expect(report.marketSummary).toHaveLength(5);
    expect(runCodexTask).not.toHaveBeenCalled();
  });

  it("keeps the paper planner inert and lets a risk veto suppress candidates", async () => {
    const fixture = await createTestDatabase();
    fixtures.push(fixture);
    const source = registerSource(fixture.database, {
      sourceKey: "test.news",
      publisher: "Test News",
      sourceType: "NEWS",
      authorityRole: "SECONDARY",
      referenceUrl: null,
      licenseUrl: null,
      licenseStatus: "UNKNOWN",
      credentialRequirement: "UNKNOWN",
    });
    const record = appendSourceRecord(fixture.database, {
      sourceId: source.id,
      recordKey: "test-event",
      recordType: "NEWS",
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: null,
      occurredAtMs: null,
      availableAtMs: null,
      rawTimeText: null,
      sourceTimeZone: null,
      canonicalUrl: null,
      dataClass: "NOT_VERIFIED",
      content: "Normalized event summary",
    });
    createMarketEvent(fixture.database, {
      category: "TEST_EVENT",
      summary: "A persisted event summary",
      marketCode: "US",
      instrument: null,
      occurredAtMs: null,
      publishedAtMs: null,
      importanceReason: "Test evidence only.",
      dataClass: "NOT_VERIFIED",
      verificationLevel: "NOT_VERIFIED",
      verificationReason: null,
      verificationRuleVersion: null,
      primarySourceRecordId: record.id,
      evidence: [{ sourceRecordId: record.id, relation: "SUPPORTS" }],
    });
    const role = {
      status: "DONE" as const,
      summary: "Reviewed persisted evidence.",
      evidenceIds: [record.id],
    };
    vi.mocked(runCodexTask).mockResolvedValue({
      callId: "codex-call",
      startedAtMs: Date.now(),
      completedAtMs: Date.now(),
      sourceReferences: [],
      dataClass: "NOT_VERIFIED",
      status: "DONE",
      output: JSON.stringify({
        facts: [
          { text: "A persisted event exists.", evidenceIds: [record.id] },
        ],
        inferences: [],
        hypotheses: [],
        candidates: [
          {
            marketCode: "US",
            symbol: "TEST",
            logic: "Candidate requiring price data",
            trigger: "Only after prices are verified",
            invalidation: null,
            opposingCase: null,
            evidenceIds: [record.id],
            unresolvedQuestions: [],
          },
        ],
        roleAudit: {
          coordinator: role,
          intelligence: role,
          marketStructure: role,
          strategyResearch: role,
          riskOfficer: role,
          paperPlanner: {
            status: "SKIPPED",
            summary: "No deterministic paper gate.",
            evidenceIds: [record.id],
          },
        },
        riskOfficerReview: {
          opinion: "VETO",
          summary: "Evidence is unverified.",
          evidenceIds: [record.id],
        },
        riskReasons: ["Evidence is not verified."],
        finalDecision: "Do not trade.",
      }),
      verificationStatus: "NOT_VERIFIED",
      usage: null,
    });

    const report = await runResearchReportWorkflow({
      database: fixture.database,
      taskRunId: "9aa04b35-19ae-40ea-b0cb-c4c01bddae2b",
      type: "DAILY_AUDIT",
      signal: new AbortController().signal,
    });

    expect(report.riskVerdict?.status).toBe("REJECTED");
    expect(report.candidates).toEqual([]);
    expect(report.roleAudit.paperPlanner.status).toBe("SKIPPED");
    expect(
      fixture.database.orm.select().from(paperAccounts).all(),
    ).toHaveLength(0);
  });
});
