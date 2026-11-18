import { z } from "zod";
import { getLocalDatabasePath, openDatabase } from "../../db/index.ts";
import type {
  TaskHandler,
  TaskHandlerContext,
  TaskHandlerResult,
} from "../task-queue/types.ts";
import { runResearchReportWorkflow } from "../research/workflows/report.ts";
import { archiveResearchReport, getArchivedResearchReport } from "./archive.ts";
import { reportTypeSchema } from "./contract.ts";

const reportTaskInputSchema = z.strictObject({ type: reportTypeSchema });

function reportTaskOutcome(
  report: NonNullable<ReturnType<typeof getArchivedResearchReport>>,
): TaskHandlerResult {
  const resultCode = report.resultCode ?? "REPORT_ARCHIVED";
  const details = {
    reportId: report.id,
    verificationLevel: report.verificationLevel,
    candidateCount: report.candidates.length,
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
  if (existing) return reportTaskOutcome(existing);

  const report = await runResearchReportWorkflow({
    database,
    signal: context.signal,
    taskRunId: context.taskRunId,
    type: input.data.type,
  });
  return reportTaskOutcome(archiveResearchReport(database, report).report);
}

export const researchReportHandler: TaskHandler = async (context) => {
  const database = await openDatabase(getLocalDatabasePath());
  try {
    return await runResearchReportTask(database, context);
  } finally {
    database.client.close();
  }
};
