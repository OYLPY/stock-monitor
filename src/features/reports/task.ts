import { z } from "zod";
import { getLocalDatabasePath, openDatabase } from "../../db/index.ts";
import type {
  TaskHandler,
  TaskHandlerContext,
  TaskHandlerResult,
} from "../task-queue/types.ts";
import { auditPaperLedger } from "../paper/audit.ts";
import { runResearchReportWorkflow } from "../research/workflows/report.ts";
import { archiveResearchReport, getArchivedResearchReport } from "./archive.ts";
import { reportTypeSchema } from "./contract.ts";

const reportTaskInputSchema = z.strictObject({ type: reportTypeSchema });

function reportTaskOutcome(
  report: NonNullable<ReturnType<typeof getArchivedResearchReport>>,
  runDetails: {
    scheduledLocalAt: string;
    scheduledAtMs: number;
    delayMs: number | null;
    delayed: boolean;
    reportGeneratedAtMs: number | null;
  },
): TaskHandlerResult {
  const resultCode = report.resultCode ?? "REPORT_ARCHIVED";
  const details = {
    reportId: report.id,
    verificationLevel: report.verificationLevel,
    candidateCount: report.candidates.length,
    ...runDetails,
  };
  if (report.executionStatus === "FAILED") {
    throw Object.assign(new Error(resultCode), { code: resultCode });
  }
  if (report.executionStatus === "BLOCKED_EXTERNAL") {
    return {
      executionStatus: "BLOCKED_EXTERNAL",
      resultCode,
      errorCode: resultCode,
      details,
    };
  }
  if (report.executionStatus === "SKIPPED") {
    return { executionStatus: "SKIPPED", resultCode, details };
  }
  return { resultCode, details };
}

export async function runResearchReportTask(
  database: Parameters<typeof runResearchReportWorkflow>[0]["database"],
  context: TaskHandlerContext,
): Promise<TaskHandlerResult> {
  if (context.signal.aborted)
    return { executionStatus: "SKIPPED" as const, resultCode: "CANCELLED" };

  const input = reportTaskInputSchema.safeParse(context.input);
  if (!input.success) {
    throw Object.assign(new Error("REPORT_TASK_INPUT_INVALID"), {
      code: "REPORT_TASK_INPUT_INVALID",
    });
  }

  const existing = getArchivedResearchReport(database, context.taskRunId);
  if (existing) {
    const reportGeneratedAtMs = existing.generatedAtMs;
    const delayMs =
      reportGeneratedAtMs === null
        ? null
        : Math.max(0, reportGeneratedAtMs - context.scheduledAtMs);
    return reportTaskOutcome(existing, {
      scheduledLocalAt: context.scheduledLocalAt,
      scheduledAtMs: context.scheduledAtMs,
      delayMs,
      delayed: delayMs !== null && delayMs >= 60_000,
      reportGeneratedAtMs,
    });
  }

  const paperAudit =
    input.data.type === "DAILY_AUDIT" ? auditPaperLedger(database) : undefined;
  const generatedReport = await runResearchReportWorkflow({
    database,
    signal: context.signal,
    taskRunId: context.taskRunId,
    type: input.data.type,
  });
  const reportGeneratedAtMs = generatedReport.generatedAtMs;
  const delayMs =
    reportGeneratedAtMs === null
      ? null
      : Math.max(0, reportGeneratedAtMs - context.scheduledAtMs);
  const paperLedgerAudit =
    paperAudit === undefined
      ? undefined
      : {
          ledgerStatus: paperAudit?.ledger.status ?? "NOT_VERIFIED",
          ledgerIssueCodes: paperAudit?.ledger.issueCodes ?? [
            "PAPER_ACCOUNT_NOT_INITIALIZED",
          ],
          equityStatus: paperAudit?.equity.status ?? "NOT_VERIFIED",
          equityIssueCodes: paperAudit?.equity.issueCodes ?? [
            "PAPER_ACCOUNT_NOT_INITIALIZED",
          ],
          maximumDrawdownBasisPoints:
            paperAudit?.equity.maximumDrawdown?.basisPoints ?? null,
        };
  const runDetails = {
    scheduledLocalAt: context.scheduledLocalAt,
    scheduledAtMs: context.scheduledAtMs,
    delayMs,
    delayed: delayMs !== null && delayMs >= 60_000,
    reportGeneratedAtMs,
  };
  const report = {
    ...generatedReport,
    ...(delayMs !== null && delayMs >= 60_000
      ? {
          limitations: [
            ...generatedReport.limitations,
            `计划时刻 ${context.scheduledLocalAt} 已错过 ${Math.floor(delayMs / 60_000)} 分钟；报告使用实际生成时刻，不代表该计划时段的盘中扫描。`,
          ],
        }
      : {}),
    ...(paperLedgerAudit
      ? {
          ledgerSummary: [
            generatedReport.ledgerSummary,
            `纸面账本审计：账本 ${paperLedgerAudit.ledgerStatus}（${paperLedgerAudit.ledgerIssueCodes.join(", ") || "无异常"}）；权益 ${paperLedgerAudit.equityStatus}（${paperLedgerAudit.equityIssueCodes.join(", ") || "无异常"}）；最大回撤 ${paperLedgerAudit.maximumDrawdownBasisPoints === null ? "未核验" : `${paperLedgerAudit.maximumDrawdownBasisPoints} bp`}。`,
          ]
            .filter((summary): summary is string => summary !== null)
            .join(" "),
        }
      : {}),
  };
  return reportTaskOutcome(
    archiveResearchReport(database, report).report,
    runDetails,
  );
}

export const researchReportHandler: TaskHandler = async (context) => {
  const database = await openDatabase(getLocalDatabasePath());
  try {
    return await runResearchReportTask(database, context);
  } finally {
    database.client.close();
  }
};
