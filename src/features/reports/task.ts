import { z } from "zod";
import { getLocalDatabasePath, openDatabase } from "../../db/index.ts";
import {
  collectBlsSeries,
  collectBojRss,
  collectBojSeries,
  collectFederalReserveRss,
  disclosureSourcePolicies,
} from "../../providers/disclosures/index.ts";
import type { ResearchEvidenceReference } from "../research/evidence-checker.ts";
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
const BLS_SERIES = ["CUUR0000SA0", "LNS14000000"] as const;
const BOJ_FX_SERIES = ["FXERD04", "FXERD05"] as const;

function observationPeriod(value: string | null) {
  const match = value?.match(/^(\d{4}) M(0[1-9]|1[0-2])\b/);
  return match ? Number(match[1]) * 100 + Number(match[2]) : null;
}

function reportSourceText(record: {
  provider: string;
  title: string;
  rawTimeText: string | null;
  publishedAtMs: bigint | null;
}) {
  if (record.provider === "bls.api") {
    const seriesId = record.title.split(" ", 1)[0];
    const value = record.title.match(/: ([^:]+)$/)?.[1];
    if (seriesId === "CUUR0000SA0") {
      return `${record.rawTimeText}: U.S. CPI-U all items index, not seasonally adjusted, base 1982-84=100: ${value}`;
    }
    if (seriesId === "LNS14000000") {
      return `${record.rawTimeText}: U.S. seasonally adjusted unemployment rate: ${value}%`;
    }
  }
  if (record.provider === "boj.timeseries") {
    return `${record.rawTimeText} Asia/Tokyo observation date: ${record.title}`;
  }
  const publishedAt =
    record.publishedAtMs === null
      ? ""
      : `; publishedAt=${new Date(Number(record.publishedAtMs)).toISOString()}`;
  return `${record.title}${publishedAt}`;
}

export async function collectReportSources(
  database: Parameters<typeof runResearchReportWorkflow>[0]["database"],
  nowMs: number,
  fetcher: typeof fetch,
) {
  const tokyoDateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(nowMs)
      .map(({ type, value }) => [type, value]),
  );
  const year = Number(tokyoDateParts.year);
  const [bls, bojFx, fedRss, bojRss] = await Promise.all([
    collectBlsSeries(
      database,
      {
        seriesIds: [...BLS_SERIES],
        startYear: String(year - 1),
        endYear: String(year),
      },
      fetcher,
    ),
    collectBojSeries(
      database,
      {
        databaseCode: "FM08",
        seriesCodes: [...BOJ_FX_SERIES],
        startDate: `${year - 1}01`,
        endDate: `${year}${tokyoDateParts.month}`,
      },
      fetcher,
    ),
    collectFederalReserveRss(
      database,
      { feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml" },
      fetcher,
    ),
    collectBojRss(
      database,
      { feedUrl: "https://www.boj.or.jp/en/rss/whatsnew.xml" },
      fetcher,
    ),
  ]);
  const latestBlsBySeries = new Map<string, typeof bls.records>();
  for (const record of bls.records) {
    const seriesId = record.title.split(" ", 1)[0];
    latestBlsBySeries.set(seriesId, [
      ...(latestBlsBySeries.get(seriesId) ?? []),
      record,
    ]);
  }
  const selectedBls = [...latestBlsBySeries.values()].flatMap((records) =>
    records
      .filter((record) => observationPeriod(record.record.rawTimeText) !== null)
      .sort(
        (left, right) =>
          observationPeriod(right.record.rawTimeText)! -
          observationPeriod(left.record.rawTimeText)!,
      )
      .slice(0, 13),
  );
  const latestBojBySeries = new Map<string, typeof bojFx.records>();
  for (const record of bojFx.records) {
    const seriesCode = record.title.split(" ", 1)[0];
    latestBojBySeries.set(seriesCode, [
      ...(latestBojBySeries.get(seriesCode) ?? []),
      record,
    ]);
  }
  const selectedBojFx = [...latestBojBySeries.values()].flatMap((records) =>
    records
      .sort((left, right) =>
        (right.record.rawTimeText ?? "").localeCompare(
          left.record.rawTimeText ?? "",
        ),
      )
      .slice(0, 5),
  );
  const selectedRecords = [
    ...selectedBls,
    ...selectedBojFx,
    ...fedRss.records.slice(0, 5),
    ...bojRss.records.slice(0, 5),
  ];
  const sourceReferences: ResearchEvidenceReference[] = selectedRecords.map(
    ({ provider, title, record, source }) => ({
      id: record.id,
      canonicalUrl: record.canonicalUrl,
      publishedAtMs:
        record.publishedAtMs === null ? null : Number(record.publishedAtMs),
      occurredAtMs:
        record.occurredAtMs === null ? null : Number(record.occurredAtMs),
      availableAtMs:
        record.availableAtMs === null ? null : Number(record.availableAtMs),
      collectedAtMs: Number(record.collectedAtMs),
      timestampInvalid: [
        record.publishedAtMs,
        record.occurredAtMs,
        record.availableAtMs,
        record.collectedAtMs,
      ].some(
        (timestamp) =>
          timestamp !== null &&
          (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0),
      ),
      dataClass: record.dataClass,
      publisher: source.publisher,
      referenceUrl: record.canonicalUrl,
      authorityRole: source.authorityRole,
      licenseStatus:
        provider === "issuer.ir"
          ? "UNKNOWN"
          : disclosureSourcePolicies[provider].licenseStatus,
      marketCode: null,
      currencyCodes: provider === "boj.timeseries" ? ["JPY", "USD"] : [],
      units: [],
      text: [
        reportSourceText({
          provider,
          title,
          rawTimeText: record.rawTimeText,
          publishedAtMs: record.publishedAtMs,
        }),
      ],
    }),
  );
  const sourceCollectionStatuses = [
    `BLS v1: ${bls.status}; ${bls.records.length} observations stored; ${bls.reason}`,
    `BOJ USD/JPY daily series: ${bojFx.status}; ${bojFx.records.length} observations stored; ${bojFx.reason}`,
    `Federal Reserve RSS: ${fedRss.status}; ${fedRss.records.length} references stored; ${fedRss.reason}`,
    `BOJ RSS: ${bojRss.status}; ${bojRss.records.length} references stored; ${bojRss.reason}`,
  ];
  return { sourceReferences, sourceCollectionStatuses };
}

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
  fetcher: typeof fetch = fetch,
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
  const reportSources = await collectReportSources(
    database,
    Date.now(),
    fetcher,
  );
  const generatedReport = await runResearchReportWorkflow({
    database,
    signal: context.signal,
    taskRunId: context.taskRunId,
    type: input.data.type,
    ...reportSources,
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
