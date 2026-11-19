import { randomUUID } from "node:crypto";

import { getLocalDatabasePath, openDatabase } from "../../src/db/index.ts";
import {
  appendSourceRecord,
  registerSource,
} from "../../src/features/evidence/repository.ts";
import { archiveResearchReport } from "../../src/features/reports/archive.ts";
import type { ResearchReport } from "../../src/features/reports/contract.ts";
import {
  claimNextTask,
  enqueueScheduledTask,
  finishTaskRun,
} from "../../src/features/task-queue/queue.ts";

async function seedFixtureReport() {
  const database = await openDatabase(getLocalDatabasePath());
  try {
    const nowMs = Date.now();
    const task = enqueueScheduledTask(database, {
      idempotencyKey: `e2e:p12-03:${randomUUID()}`,
      runType: "RESEARCH_REPORT",
      input: { type: "MORNING" },
      timeZone: "Asia/Tokyo",
      scheduledLocalAt: new Date(nowMs).toISOString().slice(0, 16),
      timeoutMs: 900_000,
      createdAtMs: nowMs,
    }).task;
    const claimedTask = claimNextTask(
      database,
      `p12-03-e2e-${randomUUID()}`,
      nowMs,
      60_000,
    );
    if (!claimedTask || claimedTask.id !== task.id) {
      throw new Error("e2e_fixture_task_claim_failed");
    }

    const source = registerSource(database, {
      sourceKey: `e2e-p12-03-${task.id}`,
      publisher: "P12-03 E2E Fixture",
      sourceType: "OTHER",
      authorityRole: "FIXTURE",
      referenceUrl: null,
      licenseUrl: null,
      licenseStatus: "NOT_VERIFIED",
      credentialRequirement: "NOT_REQUIRED",
    });
    const evidence = appendSourceRecord(database, {
      sourceId: source.id,
      recordKey: `p12-03-e2e:${task.id}`,
      recordType: "OTHER",
      recordVersion: 1,
      supersedesRecordId: null,
      publishedAtMs: nowMs,
      occurredAtMs: nowMs,
      availableAtMs: nowMs,
      rawTimeText: null,
      sourceTimeZone: "Asia/Tokyo",
      canonicalUrl: null,
      dataClass: "FIXTURE",
      content: "P12-03 E2E fixture only; not market evidence.",
    });
    const report: ResearchReport = {
      id: task.id,
      type: "MORNING",
      title: "P12-03 E2E Fixture：风控否决与证据展示",
      generatedAtMs: nowMs,
      asOfMs: nowMs,
      timeZone: "Asia/Tokyo",
      executionStatus: "DONE",
      verificationLevel: "DEMO_ONLY",
      dataClass: "FIXTURE",
      resultCode: "E2E_FIXTURE",
      marketSummary: [
        "E2E Fixture：没有已核验的美股行情。",
        "E2E Fixture：没有已核验的日股行情。",
        "未提供真实实时报价或成交量。",
        "没有策略候选、回测结果或模拟成交。",
        "此记录仅用于验证本地报告归档和展示。",
      ].map((text) => ({ text, evidenceIds: [evidence.id] })),
      marketCalendars: [],
      eventTimeline: {
        status: "NOT_VERIFIED",
        asOfMs: nowMs,
        recentEvents: [],
        upcoming24hEvents: [],
        note: "E2E Fixture；没有执行市场扫描。",
      },
      facts: [
        {
          text: "E2E Fixture 记录；不是市场事实。",
          evidenceIds: [evidence.id],
        },
      ],
      inferences: [],
      hypotheses: [],
      candidates: [],
      evidenceValidation: { status: "NOT_RUN", rejections: [] },
      roleAudit: {
        coordinator: {
          status: "SKIPPED",
          summary: "E2E Fixture only.",
          evidenceIds: [],
        },
        intelligence: {
          status: "SKIPPED",
          summary: "E2E Fixture only.",
          evidenceIds: [],
        },
        marketStructure: {
          status: "SKIPPED",
          summary: "E2E Fixture only.",
          evidenceIds: [],
        },
        strategyResearch: {
          status: "SKIPPED",
          summary: "E2E Fixture only.",
          evidenceIds: [],
        },
        riskOfficer: {
          status: "SKIPPED",
          summary: "E2E Fixture veto display only.",
          evidenceIds: [evidence.id],
        },
        paperPlanner: {
          status: "SKIPPED",
          summary: "No paper plan was created.",
          evidenceIds: [],
        },
      },
      riskVerdict: {
        status: "REJECTED",
        reasons: ["E2E Fixture 风险否决展示；不是实际交易风险裁决。"],
      },
      riskOfficerReview: {
        opinion: "VETO",
        summary:
          "E2E Fixture only; no real risk analysis or order was performed.",
        evidenceIds: [evidence.id],
      },
      ledgerState: "NOT_INITIALIZED",
      ledgerSummary: "E2E Fixture 数据库未初始化纸面账户。",
      sourceCoverage: [
        {
          id: source.id,
          name: "P12-03 E2E Fixture 来源",
          url: null,
          status: "AVAILABLE",
          dataClass: "FIXTURE",
          marketAtMs: null,
          marketTimeZone: null,
          collectedAtMs: nowMs,
          collectedTimeZone: "Asia/Tokyo",
          currency: null,
          delayStatement: "E2E Fixture；不是行情报价。",
          limitation: "只用于测试来源追溯，不代表真实市场数据。",
          evidenceIds: [evidence.id],
        },
      ],
      limitations: [
        "E2E Fixture；没有保存的真实来源、行情、财报或公告。",
        "该 E2E Fixture 仅验证归档、证据编号和风控否决的 UI 呈现。",
      ],
      finalDecision:
        "仅验证 E2E Fixture 呈现；不代表真实行情、确定性风险审批或纸面交易。",
    };

    archiveResearchReport(database, report);
    finishTaskRun(
      database,
      claimedTask,
      {
        executionStatus: "DONE",
        resultCode: "E2E_FIXTURE_ARCHIVED",
        details: { fixture: true },
      },
      nowMs + 1,
    );
  } finally {
    database.client.close();
  }
}

seedFixtureReport().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
