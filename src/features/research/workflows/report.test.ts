import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/db/test-database";
import { marketPriceBars, paperAccounts } from "@/db/schema";
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

function addQualifiedBars(
  database: Awaited<ReturnType<typeof createTestDatabase>>["database"],
  input: { marketCode: "US" | "JP"; symbol: string; nowMs: number },
) {
  const source = registerSource(database, {
    sourceKey: `test-${input.marketCode.toLowerCase()}-${input.symbol.toLowerCase()}`,
    publisher: "Test Exchange",
    sourceType: "EXCHANGE",
    authorityRole: "EXCHANGE_PRIMARY",
    referenceUrl: "https://example.test/market-data",
    licenseUrl: null,
    licenseStatus: "VERIFIED",
    credentialRequirement: "NOT_REQUIRED",
  });
  const latestDate = new Date(input.nowMs - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const sourceRecordIds: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    const tradingDate = new Date(
      Date.parse(`${latestDate}T00:00:00.000Z`) - (29 - index) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const record = appendSourceRecord(database, {
      sourceId: source.id,
      recordKey: `${input.marketCode}-${input.symbol}-${tradingDate}`,
      recordType: "MARKET_QUOTE",
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: input.nowMs - 60_000,
      occurredAtMs: null,
      availableAtMs: null,
      rawTimeText: null,
      sourceTimeZone: null,
      canonicalUrl: `https://example.test/${input.marketCode}/${input.symbol}/${tradingDate}`,
      dataClass: "REAL",
      content: `Qualified test bar for ${tradingDate}`,
    });
    sourceRecordIds.push(record.id);
    database.orm
      .insert(marketPriceBars)
      .values({
        id: `${input.marketCode}-${input.symbol}-${index}`,
        marketCode: input.marketCode,
        symbol: input.symbol,
        tradingDate,
        openMantissa: BigInt(10_000),
        highMantissa: BigInt(11_000),
        lowMantissa: BigInt(9_000),
        closeMantissa: BigInt(10_000),
        priceScale: 2,
        volumeShares: BigInt(10_000),
        sourceRecordId: record.id,
        collectedAtMs: BigInt(input.nowMs - 60_000),
      })
      .run();
  }
  return sourceRecordIds;
}

describe("runResearchReportWorkflow", () => {
  it("archives an unverified report without candidates when local evidence is absent", async () => {
    const fixture = await createTestDatabase();
    fixtures.push(fixture);

    const report = await runResearchReportWorkflow({
      database: fixture.database,
      taskRunId: "5f6d7e10-dba1-452b-a4f3-6aa541c8fa83",
      type: "MORNING",
      signal: new AbortController().signal,
      nowMs: Date.UTC(2026, 10, 18, 14),
    });

    expect(report.verificationLevel).toBe("NOT_VERIFIED");
    expect(report.resultCode).toBe("NO_SAVED_EVIDENCE");
    expect(report.candidates).toEqual([]);
    expect(report.roleAudit.strategyResearch.status).toBe("SKIPPED");
    expect(report.roleAudit.paperPlanner.status).toBe("SKIPPED");
    expect(report.marketSummary).toHaveLength(5);
    expect(report.marketSummary[0]?.evidenceIds).toEqual([]);
    expect(report.marketSummary[1]?.evidenceIds).toEqual([]);
    expect(report.marketSummary[2]?.evidenceIds).toEqual([]);
    expect(
      report.marketCalendars
        .filter(({ exchange }) => exchange !== "TSE")
        .map(({ latestCompletedDate }) => latestCompletedDate),
    ).toEqual(["2026-11-17", "2026-11-17"]);
    expect(
      report.marketCalendars.find(({ exchange }) => exchange === "TSE")
        ?.latestCompletedDate,
    ).toBe("2026-11-18");
    expect(runCodexTask).not.toHaveBeenCalled();
  });

  it("keeps a cancelled report out of the completed state", async () => {
    const fixture = await createTestDatabase();
    fixtures.push(fixture);
    const controller = new AbortController();
    controller.abort();

    const report = await runResearchReportWorkflow({
      database: fixture.database,
      taskRunId: "b881d706-4bab-4492-ae9b-e652c42dfcee",
      type: "MORNING",
      signal: controller.signal,
    });

    expect(report.executionStatus).toBe("SKIPPED");
    expect(report.resultCode).toBe("CANCELLED");
    expect(runCodexTask).not.toHaveBeenCalled();
  });

  it("keeps the paper planner inert and lets a risk veto suppress candidates", async () => {
    const fixture = await createTestDatabase();
    fixtures.push(fixture);
    const asOfMs = Date.now() + 5_000;
    const source = registerSource(fixture.database, {
      sourceKey: "test.exchange",
      publisher: "Test Exchange",
      sourceType: "EXCHANGE",
      authorityRole: "EXCHANGE_PRIMARY",
      referenceUrl: null,
      licenseUrl: null,
      licenseStatus: "VERIFIED",
      credentialRequirement: "NOT_REQUIRED",
    });
    const record = appendSourceRecord(fixture.database, {
      sourceId: source.id,
      recordKey: "test-event",
      recordType: "NEWS",
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: asOfMs - 60_000,
      occurredAtMs: asOfMs + 12 * 60 * 60 * 1_000,
      availableAtMs: null,
      rawTimeText: null,
      sourceTimeZone: null,
      canonicalUrl: null,
      dataClass: "REAL",
      content: "Normalized event summary",
    });
    createMarketEvent(fixture.database, {
      category: "TEST_EVENT",
      summary: "A persisted future event summary",
      marketCode: "US",
      instrument: null,
      occurredAtMs: asOfMs + 12 * 60 * 60 * 1_000,
      publishedAtMs: asOfMs - 60_000,
      importanceReason: "Test evidence only.",
      dataClass: "REAL",
      verificationLevel: "VERIFIED",
      verificationReason: "Verified against the primary test record.",
      verificationRuleVersion: "test-v1",
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
      nowMs: asOfMs,
    });

    expect(report.riskVerdict?.status).toBe("REJECTED");
    expect(report.verificationLevel).toBe("NOT_VERIFIED");
    expect(report.candidates).toEqual([]);
    expect(report.eventTimeline.status).toBe("NOT_VERIFIED");
    expect(report.eventTimeline.upcoming24hEvents).toEqual([
      expect.objectContaining({
        summary: "A persisted future event summary",
        occurredAtMs: asOfMs + 12 * 60 * 60 * 1_000,
        evidenceIds: [record.id],
      }),
    ]);
    expect(report.marketSummary[2]?.evidenceIds).toEqual([record.id]);
    expect(report.evidenceValidation.status).toBe("FAILED");
    expect(report.evidenceValidation.rejections).toContainEqual(
      expect.objectContaining({
        outputPath: "candidates[0]",
        reasons: expect.arrayContaining(["CANDIDATE_SYMBOL_NOT_COVERED"]),
      }),
    );
    expect(report.sourceCoverage[0]?.url).toBeNull();
    expect(report.sourceCoverage[0]?.status).toBe("UNKNOWN");
    expect(report.roleAudit.paperPlanner.status).toBe("SKIPPED");
    expect(
      fixture.database.orm.select().from(paperAccounts).all(),
    ).toHaveLength(0);
  });

  it("marks every strategy validation dimension NOT_VERIFIED", async () => {
    const fixture = await createTestDatabase();
    fixtures.push(fixture);
    const nowMs = Date.UTC(2026, 10, 19, 2);
    const usRecordIds = addQualifiedBars(fixture.database, {
      marketCode: "US",
      symbol: "AAPL",
      nowMs,
    });
    addQualifiedBars(fixture.database, {
      marketCode: "JP",
      symbol: "7203",
      nowMs,
    });
    const role = {
      status: "DONE" as const,
      summary: "Reviewed persisted data.",
      evidenceIds: [usRecordIds.at(-1)!],
    };
    vi.mocked(runCodexTask).mockResolvedValue({
      callId: "codex-call",
      startedAtMs: nowMs,
      completedAtMs: nowMs,
      sourceReferences: [],
      dataClass: "NOT_VERIFIED",
      status: "DONE",
      output: JSON.stringify({
        facts: [],
        inferences: [],
        hypotheses: [],
        candidates: [
          {
            marketCode: "US",
            symbol: "AAPL",
            logic: "Evidence-backed but unvalidated hypothesis",
            trigger: "After the next verified signal",
            invalidation: null,
            opposingCase: null,
            evidenceIds: [usRecordIds.at(-1)],
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
            summary: "The planner is disabled.",
            evidenceIds: [],
          },
        },
        riskOfficerReview: {
          opinion: "NO_VETO",
          summary: "No evidence-backed veto.",
          evidenceIds: [usRecordIds.at(-1)],
        },
        riskReasons: [],
        finalDecision: "Observe only.",
      }),
      verificationStatus: "NOT_VERIFIED",
      usage: null,
    });

    const report = await runResearchReportWorkflow({
      database: fixture.database,
      taskRunId: "a6f4c9af-592d-4663-b132-df462a6a5d22",
      type: "MORNING",
      signal: new AbortController().signal,
      nowMs,
    });

    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]?.validationDimensions).toEqual({
      outOfSampleStability: "NOT_VERIFIED",
      afterCostReturn: "NOT_VERIFIED",
      maxDrawdown: "NOT_VERIFIED",
      executionFeasibility: "NOT_VERIFIED",
      crossEnvironmentRobustness: "NOT_VERIFIED",
    });
    expect(report.marketSummary[2]?.evidenceIds).toEqual([]);
  });
});
