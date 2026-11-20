import type { Metadata } from "next";
import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { ReportCenter } from "@/components/reports/report-center";
import { listArchivedResearchReports } from "@/features/reports/archive";
import { listTaskRuns, readTaskRun } from "@/features/task-queue/queue";

export const metadata: Metadata = { title: "晨报与策略研究 | 量化研究工作台" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReportType = "MORNING" | "ANOMALY" | "DAILY_AUDIT" | "WEEKLY_AUDIT";
type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const reportTypes: ReportType[] = [
    "MORNING",
    "ANOMALY",
    "DAILY_AUDIT",
    "WEEKLY_AUDIT",
  ];
  const rawType = firstValue(params.type);
  const type = reportTypes.includes(rawType as ReportType)
    ? (rawType as ReportType)
    : "";

  const database = await openDatabase(getLocalDatabasePath());
  try {
    const taskId = z.string().uuid().safeParse(firstValue(params.task));
    const task = taskId.success ? readTaskRun(database, taskId.data) : null;
    return (
      <ReportCenter
        enqueueError={firstValue(params.enqueue) === "error"}
        filters={{ query: firstValue(params.q)?.trim() ?? "", type }}
        reports={listArchivedResearchReports(database)}
        tasks={listTaskRuns(database).filter((item) => item.kind === "REPORT")}
        taskNotice={
          task
            ? {
                status: task.executionStatus,
              }
            : null
        }
      />
    );
  } finally {
    database.client.close();
  }
}
