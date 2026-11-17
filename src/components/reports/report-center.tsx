import { CircleHelp, Search } from "lucide-react";

import { Alert, AlertDescription } from "@/components/shadcn/alert";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/shadcn/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shadcn/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/shadcn/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/shadcn/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/select";

type ReportType = "MORNING" | "ANOMALY" | "DAILY_AUDIT" | "WEEKLY_AUDIT";
type ExecutionStatus =
  "PENDING" | "RUNNING" | "DONE" | "FAILED" | "BLOCKED_EXTERNAL" | "SKIPPED";
type VerificationLevel = "VERIFIED" | "PARTIAL" | "NOT_VERIFIED" | "DEMO_ONLY";
type DataClass = "REAL" | "DELAYED" | "HISTORICAL" | "FIXTURE" | "NOT_VERIFIED";
type RiskVerdict = "APPROVED_FOR_PAPER_REVIEW" | "REJECTED" | "UNRESOLVED";
type RoleKey =
  | "coordinator"
  | "intelligence"
  | "marketStructure"
  | "strategyResearch"
  | "riskOfficer"
  | "paperPlanner";

interface Statement {
  text: string;
  evidenceIds: string[];
}

interface StrategyCandidate {
  id: string;
  logic: string;
  trigger: string | null;
  invalidation: string | null;
  opposingCase: string | null;
  evidenceIds: string[];
  unresolvedQuestions: string[];
}

interface SourceCoverage {
  id: string;
  name: string;
  url: string | null;
  status: "AVAILABLE" | "DELAYED" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
  dataClass: DataClass;
  marketAtMs: number | null;
  marketTimeZone: string | null;
  collectedAtMs: number | null;
  collectedTimeZone: string | null;
  currency: string | null;
  delayStatement: string | null;
  limitation: string | null;
  evidenceIds: string[];
}

interface ResearchReport {
  id: string;
  type: ReportType;
  title: string;
  generatedAtMs: number | null;
  asOfMs: number | null;
  timeZone: string | null;
  executionStatus: ExecutionStatus;
  verificationLevel: VerificationLevel;
  dataClass: DataClass;
  resultCode: string | null;
  marketSummary: Statement[];
  facts: Statement[];
  inferences: Statement[];
  hypotheses: Statement[];
  candidates: StrategyCandidate[];
  roleAudit: Partial<
    Record<
      RoleKey,
      {
        status: ExecutionStatus;
        summary: string | null;
        evidenceIds: string[];
      }
    >
  >;
  riskVerdict: { status: RiskVerdict; reasons: string[] } | null;
  riskOfficerReview: {
    opinion: "VETO" | "NO_VETO";
    summary: string;
    evidenceIds: string[];
  } | null;
  ledgerState: "INITIALIZED" | "NOT_INITIALIZED" | "UNAVAILABLE";
  ledgerSummary: string | null;
  sourceCoverage: SourceCoverage[];
  limitations: string[];
  finalDecision: string | null;
}

interface ReportFilters {
  query: string;
  type: "" | ReportType;
}

const reportTypeLabels: Record<ReportType, string> = {
  MORNING: "晨报",
  ANOMALY: "异常报告",
  DAILY_AUDIT: "日度审计",
  WEEKLY_AUDIT: "周度审计",
};

const executionLabels: Record<ExecutionStatus, string> = {
  PENDING: "待处理",
  RUNNING: "进行中",
  DONE: "已完成",
  FAILED: "失败",
  BLOCKED_EXTERNAL: "外部阻断",
  SKIPPED: "已跳过",
};

const verificationLabels: Record<VerificationLevel, string> = {
  VERIFIED: "已核验",
  PARTIAL: "部分核验",
  NOT_VERIFIED: "未核验",
  DEMO_ONLY: "仅演示",
};

const dataClassLabels: Record<DataClass, string> = {
  REAL: "真实来源",
  DELAYED: "延迟数据",
  HISTORICAL: "历史数据",
  FIXTURE: "Fixture",
  NOT_VERIFIED: "未核验",
};

const sourceStatusLabels: Record<SourceCoverage["status"], string> = {
  AVAILABLE: "可用",
  DELAYED: "延迟",
  STALE: "过期",
  UNAVAILABLE: "不可用",
  UNKNOWN: "未知",
};

const riskVerdictLabels: Record<RiskVerdict, string> = {
  APPROVED_FOR_PAPER_REVIEW: "可进入纸面复核",
  REJECTED: "拒绝",
  UNRESOLVED: "未解决",
};

const roleOrder: { key: RoleKey; label: string }[] = [
  { key: "coordinator", label: "统筹 Coordinator" },
  { key: "intelligence", label: "情报侦察 Intelligence" },
  { key: "marketStructure", label: "市场结构 Market Structure" },
  { key: "strategyResearch", label: "策略研发 Strategy Research" },
  { key: "riskOfficer", label: "独立风控 Risk Officer" },
  { key: "paperPlanner", label: "模拟员 Paper Planner" },
];

function formatTime(value: number | null, timeZone: string | null) {
  if (value === null) return "未提供";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间无效";
  if (!timeZone) return `${date.toISOString()} UTC（时区未提供）`;

  try {
    return `${new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(date)} ${timeZone}`;
  } catch {
    return `${date.toISOString()} UTC（时区无效：${timeZone}）`;
  }
}

function safeSourceUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function EvidenceIds({ ids }: { ids: string[] }) {
  if (ids.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">没有已记录的证据编号。</p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>证据</span>
      {ids.map((id) => (
        <code className="rounded bg-muted px-1.5 py-0.5" key={id}>
          {id}
        </code>
      ))}
    </p>
  );
}

function StatementGroup({
  label,
  items,
}: {
  label: string;
  items: Statement[];
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-sm font-semibold">
        {label} <span className="text-muted-foreground">({items.length})</span>
      </h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无已记录内容；空列表不代表已通过核验。
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {items.map((item, index) => (
            <li
              className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 p-3"
              key={`${label}-${index}`}
            >
              <p className="break-words text-sm">{item.text}</p>
              <EvidenceIds ids={item.evidenceIds} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Definition({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function ReportCard({ report }: { report: ResearchReport }) {
  const hasFixtureInput =
    report.dataClass === "FIXTURE" ||
    report.sourceCoverage.some((source) => source.dataClass === "FIXTURE");
  const demoOnly = hasFixtureInput || report.verificationLevel === "DEMO_ONLY";
  const verificationLevel = demoOnly ? "DEMO_ONLY" : report.verificationLevel;
  const candidateLimitExceeded = report.candidates.length > 3;

  return (
    <li>
      <Card className="min-w-0">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>
              <h3 className="break-words">{report.title}</h3>
            </CardTitle>
            <CardDescription className="break-all">
              报告编号 <code>{report.id}</code>
            </CardDescription>
          </div>
          <CardAction className="flex flex-wrap gap-2">
            <Badge variant="outline">{reportTypeLabels[report.type]}</Badge>
            <Badge variant="secondary">
              {executionLabels[report.executionStatus]} ·{" "}
              {report.executionStatus}
            </Badge>
            <Badge variant={demoOnly ? "destructive" : "outline"}>
              {verificationLabels[verificationLevel]} · {verificationLevel}
            </Badge>
            <Badge variant="outline">{dataClassLabels[report.dataClass]}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {hasFixtureInput && report.verificationLevel !== "DEMO_ONLY" ? (
            <Alert variant="destructive">
              <AlertDescription>
                报告包含 Fixture 来源，按规则隔离为
                DEMO_ONLY；原验证等级与此规则不一致。
              </AlertDescription>
            </Alert>
          ) : null}

          <dl className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Definition label="生成时间">
              {formatTime(report.generatedAtMs, report.timeZone)}
            </Definition>
            <Definition label="事实截止时间 asOf">
              {formatTime(report.asOfMs, report.timeZone)}
            </Definition>
            <Definition label="报告时区">
              {report.timeZone ?? "未提供"}
            </Definition>
            <Definition label="业务结果码">
              {report.resultCode ? <code>{report.resultCode}</code> : "未提供"}
            </Definition>
          </dl>

          <section
            aria-labelledby={`summary-${report.id}`}
            className="flex flex-col gap-3"
          >
            <h4 className="text-sm font-semibold" id={`summary-${report.id}`}>
              市场摘要{" "}
              <span className="text-muted-foreground">
                ({report.marketSummary.length} 行)
              </span>
            </h4>
            {report.type === "MORNING" && report.marketSummary.length !== 5 ? (
              <p className="text-sm text-destructive">
                晨报应包含五行摘要；当前记录 {report.marketSummary.length} 行。
              </p>
            ) : null}
            {report.marketSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                没有已保存的摘要；缺失内容保持未核验。
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {report.marketSummary.map((line, index) => (
                  <li
                    className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 p-3"
                    key={`summary-${index}`}
                  >
                    <p className="break-words text-sm">
                      <span className="mr-2 font-medium text-muted-foreground">
                        {index + 1}.
                      </span>
                      {line.text}
                    </p>
                    <EvidenceIds ids={line.evidenceIds} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section
            aria-labelledby={`risk-${report.id}`}
            className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
          >
            <h4 className="text-sm font-semibold" id={`risk-${report.id}`}>
              确定性风控裁决
            </h4>
            {report.riskVerdict ? (
              <>
                <p className="text-sm">
                  {riskVerdictLabels[report.riskVerdict.status]} ·{" "}
                  <code>{report.riskVerdict.status}</code>
                </p>
                {report.riskVerdict.reasons.length ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {report.riskVerdict.reasons.map((reason, index) => (
                      <li className="break-words" key={`risk-reason-${index}`}>
                        {reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    没有记录裁决原因。
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-destructive">
                未记录确定性裁决；裁决缺失不等于通过。
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">模型风控意见</h4>
            {report.riskOfficerReview ? (
              <>
                <p className="text-sm">
                  {report.riskOfficerReview.opinion === "VETO"
                    ? "提出否决"
                    : "未提出否决"}{" "}
                  · <code>{report.riskOfficerReview.opinion}</code>
                </p>
                <p className="break-words text-sm">
                  {report.riskOfficerReview.summary}
                </p>
                <EvidenceIds ids={report.riskOfficerReview.evidenceIds} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                未记录模型风控意见。
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              模型意见不能修改确定性裁决；未提出模型否决也不代表风险通过。
            </p>
          </section>

          <section
            aria-label={`报告 ${report.id} 详细记录`}
            className="flex flex-col gap-3"
          >
            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    className="w-full justify-between"
                    size="lg"
                    variant="outline"
                  />
                }
              >
                证据与研究判断
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex min-w-0 flex-col gap-5 border-t p-4">
                  <StatementGroup label="事实" items={report.facts} />
                  <StatementGroup label="推论" items={report.inferences} />
                  <StatementGroup label="假设" items={report.hypotheses} />
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    className="w-full justify-between"
                    size="lg"
                    variant="outline"
                  />
                }
              >
                策略候选（{report.candidates.length} / 3）
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t p-4">
                  {candidateLimitExceeded ? (
                    <p className="text-sm text-destructive">
                      报告含 {report.candidates.length} 个候选，超过 3
                      个上限；为避免误用，本页不展示该组候选。
                    </p>
                  ) : report.candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      没有满足条件的候选；不为凑数生成策略。
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-4">
                      {report.candidates.map((candidate, index) => (
                        <li
                          className="min-w-0 rounded-lg bg-muted/40 p-3 sm:p-4"
                          key={candidate.id}
                        >
                          <h4 className="break-words text-sm font-semibold">
                            {index + 1}. {candidate.logic}
                          </h4>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            候选编号 <code>{candidate.id}</code>
                          </p>
                          <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                            <Definition label="触发条件">
                              {candidate.trigger ?? "未提供"}
                            </Definition>
                            <Definition label="失效条件">
                              {candidate.invalidation ?? "未提供"}
                            </Definition>
                            <Definition label="对手情形">
                              {candidate.opposingCase ?? "未提供"}
                            </Definition>
                          </dl>
                          <div className="mt-3 flex flex-col gap-3">
                            <EvidenceIds ids={candidate.evidenceIds} />
                            <div>
                              <h5 className="text-xs font-medium text-muted-foreground">
                                待验证事项
                              </h5>
                              {candidate.unresolvedQuestions.length ? (
                                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                                  {candidate.unresolvedQuestions.map(
                                    (question, questionIndex) => (
                                      <li
                                        className="break-words"
                                        key={`question-${questionIndex}`}
                                      >
                                        {question}
                                      </li>
                                    ),
                                  )}
                                </ul>
                              ) : (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  未提供
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    className="w-full justify-between"
                    size="lg"
                    variant="outline"
                  />
                }
              >
                六角色审计
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="flex flex-col gap-3 border-t p-4">
                  {roleOrder.map(({ key, label }) => {
                    const step = report.roleAudit[key];
                    return (
                      <li className="flex min-w-0 flex-col gap-1.5" key={key}>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold">{label}</h4>
                          {step ? (
                            <Badge variant="outline">
                              {executionLabels[step.status]} · {step.status}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">未记录</Badge>
                          )}
                        </div>
                        <p className="break-words text-sm text-muted-foreground">
                          {step?.summary ?? "没有已保存的步骤摘要。"}
                        </p>
                        {step ? <EvidenceIds ids={step.evidenceIds} /> : null}
                      </li>
                    );
                  })}
                </ol>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    className="w-full justify-between"
                    size="lg"
                    variant="outline"
                  />
                }
              >
                来源覆盖、限制与账本状态
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex min-w-0 flex-col gap-5 border-t p-4">
                  <section className="flex flex-col gap-3">
                    <h4 className="text-sm font-semibold">
                      来源覆盖 ({report.sourceCoverage.length})
                    </h4>
                    {report.sourceCoverage.length ? (
                      <ul className="flex min-w-0 flex-col gap-3">
                        {report.sourceCoverage.map((source) => {
                          const sourceUrl = safeSourceUrl(source.url);
                          return (
                            <li
                              className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-3"
                              key={source.id}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="break-words text-sm font-medium">
                                  {source.name}
                                </h5>
                                <Badge variant="outline">
                                  {sourceStatusLabels[source.status]}
                                </Badge>
                                <Badge variant="secondary">
                                  {dataClassLabels[source.dataClass]}
                                </Badge>
                              </div>
                              <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                                <Definition label="市场时间">
                                  {formatTime(
                                    source.marketAtMs,
                                    source.marketTimeZone,
                                  )}
                                </Definition>
                                <Definition label="本机采集时间">
                                  {formatTime(
                                    source.collectedAtMs,
                                    source.collectedTimeZone,
                                  )}
                                </Definition>
                                <Definition label="币种">
                                  {source.currency ?? "未提供"}
                                </Definition>
                                <Definition label="延迟声明">
                                  {source.delayStatement ??
                                    "未提供；时效未核验"}
                                </Definition>
                              </dl>
                              {source.limitation ? (
                                <p className="break-words text-sm">
                                  {source.limitation}
                                </p>
                              ) : null}
                              <EvidenceIds ids={source.evidenceIds} />
                              <p className="text-sm">
                                {sourceUrl ? (
                                  <a
                                    className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                    href={sourceUrl}
                                    rel="noreferrer noopener"
                                    target="_blank"
                                  >
                                    打开来源
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">
                                    没有可打开的 HTTPS 来源链接
                                  </span>
                                )}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        没有已保存的来源覆盖记录。
                      </p>
                    )}
                  </section>

                  <section className="flex flex-col gap-2">
                    <h4 className="text-sm font-semibold">
                      未解决限制 ({report.limitations.length})
                    </h4>
                    {report.limitations.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {report.limitations.map((limitation, index) => (
                          <li
                            className="break-words"
                            key={`limitation-${index}`}
                          >
                            {limitation}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        未提供限制说明。
                      </p>
                    )}
                  </section>

                  <section className="flex flex-col gap-2">
                    <h4 className="text-sm font-semibold">纸面账本</h4>
                    <p className="text-sm">
                      {report.ledgerState === "INITIALIZED"
                        ? "已初始化"
                        : report.ledgerState === "NOT_INITIALIZED"
                          ? "未初始化"
                          : "不可用"}{" "}
                      · <code>{report.ledgerState}</code>
                    </p>
                    <p className="break-words text-sm text-muted-foreground">
                      {report.ledgerSummary ??
                        "未提供账本摘要；不推算权益、持仓、订单或盈亏。"}
                    </p>
                  </section>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          <section className="flex flex-col gap-1 border-t pt-3">
            <h4 className="text-sm font-semibold">最终研究决策</h4>
            <p className="break-words text-sm">
              {report.finalDecision ??
                "未提供；不能据此认为候选已通过或计划已获批。"}
            </p>
          </section>
        </CardContent>
      </Card>
    </li>
  );
}

function reportSearchText(report: ResearchReport) {
  return [
    report.id,
    report.title,
    report.type,
    report.resultCode ?? "",
    report.finalDecision ?? "",
    ...report.marketSummary.map((line) => line.text),
    ...report.facts.map((statement) => statement.text),
    ...report.inferences.map((statement) => statement.text),
    ...report.hypotheses.map((statement) => statement.text),
    ...report.candidates.flatMap((candidate) => [
      candidate.id,
      candidate.logic,
      candidate.trigger ?? "",
      candidate.invalidation ?? "",
      ...candidate.evidenceIds,
    ]),
    ...report.sourceCoverage.flatMap((source) => [
      source.id,
      source.name,
      ...source.evidenceIds,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

export function ReportCenter({
  reports,
  filters,
}: {
  reports: ResearchReport[];
  filters: ReportFilters;
}) {
  const query = filters.query.trim().toLowerCase();
  const matchingReports = reports
    .filter(
      (report) =>
        (!filters.type || report.type === filters.type) &&
        (!query || reportSearchText(report).includes(query)),
    )
    .sort(
      (first, second) =>
        (second.generatedAtMs ?? -Infinity) -
        (first.generatedAtMs ?? -Infinity),
    );

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">研究工作区</p>
        <h1
          className="scroll-mt-6 text-2xl font-semibold tracking-tight sm:text-3xl"
          id="main-content"
          tabIndex={-1}
        >
          晨报与策略研究
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          阅读已保存的报告、证据和六角色审计。研究候选不代表已验证策略、获批计划或模拟成交。
        </p>
      </header>

      <section
        aria-labelledby="report-filters-heading"
        className="flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold" id="report-filters-heading">
          筛选报告
        </h2>
        <search>
          <Card>
            <CardContent>
              <form
                action="/reports"
                aria-labelledby="report-filters-heading"
                method="get"
              >
                <FieldGroup className="min-w-0 sm:flex-row sm:flex-wrap sm:items-end">
                  <Field className="sm:w-72">
                    <FieldLabel htmlFor="report-query">
                      搜索报告、候选或证据编号
                    </FieldLabel>
                    <InputGroup className="min-h-12">
                      <InputGroupInput
                        className="min-h-12"
                        defaultValue={filters.query}
                        id="report-query"
                        name="q"
                        type="search"
                      />
                      <InputGroupAddon>
                        <Search aria-hidden="true" />
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Field className="sm:w-48">
                    <FieldLabel htmlFor="report-type">报告类型</FieldLabel>
                    <Select defaultValue={filters.type || "ALL"} name="type">
                      <SelectTrigger
                        className="min-h-12 w-full"
                        id="report-type"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">全部类型</SelectItem>
                        {Object.entries(reportTypeLabels).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button className="min-h-12" size="lg" type="submit">
                    应用筛选
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </search>
      </section>

      <section
        aria-labelledby="report-history-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold" id="report-history-heading">
            报告历史
          </h2>
          <p className="text-sm text-muted-foreground">
            {filters.type || filters.query
              ? `显示 ${matchingReports.length} / ${reports.length} 份`
              : `${reports.length} 份本机报告`}
          </p>
        </div>

        {reports.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleHelp aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>暂无已保存的报告</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>
                  报告生成与归档运行时尚未接入。没有研究数据或 AI
                  输出时，本机不会生成演示报告、策略评分或绩效数字。
                </p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : matchingReports.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                <h3>没有符合条件的报告</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>更改搜索词或报告类型后重试。</p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex flex-col gap-4">
            {matchingReports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
