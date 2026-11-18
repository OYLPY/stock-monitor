import type { AppDatabase } from "../../db/index.ts";
import {
  researchReportSchema,
  researchReportSchemaV1,
  type ResearchReport,
} from "./contract.ts";

const contentSchemaVersion = 2;

type ArchivedReportRow = {
  content_schema_version: bigint | number;
  report_json: string;
};

function parseArchivedReport(row: ArchivedReportRow): ResearchReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.report_json);
  } catch {
    throw new Error("research_report_archive_json_invalid");
  }
  const version = BigInt(row.content_schema_version);
  if (version === BigInt(1)) return researchReportSchemaV1.parse(parsed);
  if (version !== BigInt(contentSchemaVersion)) {
    throw new Error("research_report_archive_version_unsupported");
  }
  return researchReportSchema.parse(parsed);
}

export function getArchivedResearchReport(
  database: AppDatabase,
  taskRunId: string,
) {
  const row = database.client
    .prepare(
      "SELECT content_schema_version, report_json FROM research_reports WHERE task_run_id = ?",
    )
    .get(taskRunId) as ArchivedReportRow | undefined;
  return row ? parseArchivedReport(row) : null;
}

export function archiveResearchReport(
  database: AppDatabase,
  value: ResearchReport,
) {
  const report = researchReportSchema.parse(value);
  const result = database.client
    .prepare(
      `INSERT INTO research_reports
        (task_run_id, report_type, verification_level, content_schema_version, report_json, archived_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_run_id) DO NOTHING`,
    )
    .run(
      report.id,
      report.type,
      report.verificationLevel,
      contentSchemaVersion,
      JSON.stringify(report),
      BigInt(report.generatedAtMs ?? Date.now()),
    );
  const archived = getArchivedResearchReport(database, report.id);
  if (!archived) throw new Error("research_report_archive_missing");
  return { report: archived, created: result.changes === 1 };
}

export function listArchivedResearchReports(database: AppDatabase) {
  const rows = database.client
    .prepare(
      `SELECT content_schema_version, report_json FROM research_reports
       ORDER BY archived_at_ms DESC, task_run_id DESC`,
    )
    .all() as ArchivedReportRow[];
  return rows.map(parseArchivedReport);
}
