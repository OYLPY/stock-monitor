import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/db/test-database";
import { enqueueScheduledTask } from "../task-queue/queue";
import { runResearchReportTask } from "./task";
import {
  archiveResearchReport,
  getArchivedResearchReport,
  listArchivedResearchReports,
} from "./archive";

function enqueue(
  database: Parameters<typeof enqueueScheduledTask>[0],
  type: "MORNING" | "DAILY_AUDIT" = "MORNING",
) {
  return enqueueScheduledTask(database, {
    idempotencyKey: randomUUID(),
    runType: "RESEARCH_REPORT",
    input: { type },
    timeZone: "Asia/Tokyo",
    scheduledLocalAt: "2000-01-01T00:00",
    timeoutMs: 60_000,
  }).task;
}

const offlineFetcher: typeof fetch = async () => {
  throw new Error("offline_test_source");
};

function runOfflineReportTask(
  database: Parameters<typeof runResearchReportTask>[0],
  context: Parameters<typeof runResearchReportTask>[1],
) {
  return runResearchReportTask(database, context, offlineFetcher);
}

describe("research report archive", () => {
  it("archives missing-data reports without candidates and deduplicates task retries", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database);
      const context = {
        taskRunId: task.id,
        idempotencyKey: task.idempotencyKey,
        attemptNo: 1,
        input: JSON.parse(task.inputJson),
        runType: task.runType,
        timeZone: task.timeZone,
        scheduledLocalAt: task.scheduledLocalAt,
        scheduledAtMs: task.scheduledAtMs,
        signal: new AbortController().signal,
      };

      const first = await runOfflineReportTask(fixture.database, context);
      const retry = await runOfflineReportTask(fixture.database, context);
      const reports = listArchivedResearchReports(fixture.database);

      expect(first.details).toEqual(retry.details);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        id: task.id,
        executionStatus: "DONE",
        verificationLevel: "NOT_VERIFIED",
        resultCode: "NO_SAVED_EVIDENCE",
        candidates: [],
      });
      expect(getArchivedResearchReport(fixture.database, task.id)).toEqual(
        reports[0],
      );

      const nextTask = enqueue(fixture.database);
      await runOfflineReportTask(fixture.database, {
        ...context,
        taskRunId: nextTask.id,
        idempotencyKey: nextTask.idempotencyKey,
      });
      expect(listArchivedResearchReports(fixture.database)).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("archives the deterministic paper audit and marks delayed report execution", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database, "DAILY_AUDIT");
      const result = await runOfflineReportTask(fixture.database, {
        taskRunId: task.id,
        idempotencyKey: task.idempotencyKey,
        attemptNo: 1,
        input: JSON.parse(task.inputJson),
        runType: task.runType,
        timeZone: task.timeZone,
        scheduledLocalAt: task.scheduledLocalAt,
        scheduledAtMs: task.scheduledAtMs,
        signal: new AbortController().signal,
      });
      const report = getArchivedResearchReport(fixture.database, task.id);

      expect(report?.ledgerSummary).toContain("纸面账本审计：账本");
      expect(
        report?.limitations.some((item) => item.includes("计划时刻")),
      ).toBe(true);
      expect(result.details).toMatchObject({
        delayed: true,
        scheduledLocalAt: task.scheduledLocalAt,
      });
      expect(report).toMatchObject({
        verificationLevel: "NOT_VERIFIED",
        candidates: [],
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("preserves externally blocked reports in the archive", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database);
      const complete = await runOfflineReportTask(fixture.database, {
        taskRunId: task.id,
        idempotencyKey: task.idempotencyKey,
        attemptNo: 1,
        input: JSON.parse(task.inputJson),
        runType: task.runType,
        timeZone: task.timeZone,
        scheduledLocalAt: task.scheduledLocalAt,
        scheduledAtMs: task.scheduledAtMs,
        signal: new AbortController().signal,
      });
      expect(complete.resultCode).toBe("NO_SAVED_EVIDENCE");
      const report = getArchivedResearchReport(fixture.database, task.id);
      if (!report) throw new Error("test_report_missing");

      const blockedTask = enqueue(fixture.database);
      archiveResearchReport(fixture.database, {
        ...report,
        id: blockedTask.id,
        executionStatus: "BLOCKED_EXTERNAL",
        resultCode: "CODEX_UNAVAILABLE",
      });

      expect(
        getArchivedResearchReport(fixture.database, blockedTask.id),
      ).toMatchObject({
        executionStatus: "BLOCKED_EXTERNAL",
        resultCode: "CODEX_UNAVAILABLE",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects an archive content version it cannot parse", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database);
      await runOfflineReportTask(fixture.database, {
        taskRunId: task.id,
        idempotencyKey: task.idempotencyKey,
        attemptNo: 1,
        input: JSON.parse(task.inputJson),
        runType: task.runType,
        timeZone: task.timeZone,
        scheduledLocalAt: task.scheduledLocalAt,
        scheduledAtMs: task.scheduledAtMs,
        signal: new AbortController().signal,
      });
      fixture.database.client
        .prepare(
          "UPDATE research_reports SET content_schema_version = 99 WHERE task_run_id = ?",
        )
        .run(task.id);

      expect(() =>
        getArchivedResearchReport(fixture.database, task.id),
      ).toThrow("research_report_archive_version_unsupported");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reads version 1 candidates with explicitly unverified dimensions", async () => {
    const fixture = await createTestDatabase();
    try {
      const task = enqueue(fixture.database);
      await runOfflineReportTask(fixture.database, {
        taskRunId: task.id,
        idempotencyKey: task.idempotencyKey,
        attemptNo: 1,
        input: JSON.parse(task.inputJson),
        runType: task.runType,
        timeZone: task.timeZone,
        scheduledLocalAt: task.scheduledLocalAt,
        scheduledAtMs: task.scheduledAtMs,
        signal: new AbortController().signal,
      });
      const report = getArchivedResearchReport(fixture.database, task.id);
      if (!report) throw new Error("test_report_missing");

      const legacyTask = enqueue(fixture.database);
      archiveResearchReport(fixture.database, {
        ...report,
        id: legacyTask.id,
        candidates: [
          {
            id: "legacy-candidate",
            marketCode: "US",
            symbol: "AAPL",
            logic: "Legacy candidate",
            trigger: null,
            invalidation: null,
            opposingCase: null,
            evidenceIds: [],
            unresolvedQuestions: [],
            validationDimensions: {
              outOfSampleStability: "NOT_VERIFIED",
              afterCostReturn: "NOT_VERIFIED",
              maxDrawdown: "NOT_VERIFIED",
              executionFeasibility: "NOT_VERIFIED",
              crossEnvironmentRobustness: "NOT_VERIFIED",
            },
          },
        ],
      });
      const stored = fixture.database.client
        .prepare(
          "SELECT report_json FROM research_reports WHERE task_run_id = ?",
        )
        .get(legacyTask.id) as { report_json: string };
      const legacy = JSON.parse(stored.report_json) as {
        candidates: Record<string, unknown>[];
      };
      delete legacy.candidates[0].validationDimensions;
      fixture.database.client
        .prepare(
          "UPDATE research_reports SET content_schema_version = 1, report_json = ? WHERE task_run_id = ?",
        )
        .run(JSON.stringify(legacy), legacyTask.id);

      expect(
        getArchivedResearchReport(fixture.database, legacyTask.id)
          ?.candidates[0]?.validationDimensions,
      ).toEqual({
        outOfSampleStability: "NOT_VERIFIED",
        afterCostReturn: "NOT_VERIFIED",
        maxDrawdown: "NOT_VERIFIED",
        executionFeasibility: "NOT_VERIFIED",
        crossEnvironmentRobustness: "NOT_VERIFIED",
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
