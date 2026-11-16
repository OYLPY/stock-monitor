import type { Metadata } from "next";

import { ReportCenter } from "@/components/reports/report-center";

export const metadata: Metadata = { title: "晨报与策略研究 | 量化研究工作台" };

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

  return (
    <ReportCenter
      filters={{ query: firstValue(params.q)?.trim() ?? "", type }}
      reports={[]}
    />
  );
}
