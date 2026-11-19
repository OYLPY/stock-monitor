import { randomUUID } from "node:crypto";
import { CircleHelp, Search } from "lucide-react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/alert";
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
import { Item } from "@/components/shadcn/item";
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
import { Separator } from "@/components/shadcn/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { CancelTaskButton } from "@/components/tasks/cancel-task-button";
import type { TaskRunQueueItem } from "@/features/task-queue/queue";

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
  validationDimensions: {
    outOfSampleStability: "NOT_VERIFIED";
    afterCostReturn: "NOT_VERIFIED";
    maxDrawdown: "NOT_VERIFIED";
    executionFeasibility: "NOT_VERIFIED";
    crossEnvironmentRobustness: "NOT_VERIFIED";
  };
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

interface MarketCalendarSnapshot {
  exchange: "NYSE" | "NASDAQ" | "TSE";
  marketCode: "US" | "JP";
  date: string;
  currentStatus: "OPEN" | "CLOSED" | "CALENDAR_UNAVAILABLE";
  currentReason: string | null;
  latestCompletedDate: string | null;
  timeZone: string;
  calendarVersion: string;
  checkedAt: string;
  sourceUrls: string[];
}

interface ReportEvent {
  category: string;
  summary: string;
  marketCode: "US" | "JP" | null;
  occurredAtMs: number;
  dataClass: DataClass;
  verificationLevel: VerificationLevel;
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
  marketCalendars: MarketCalendarSnapshot[];
  eventTimeline: {
    status: "NOT_VERIFIED";
    asOfMs: number;
    recentEvents: ReportEvent[];
    upcoming24hEvents: ReportEvent[];
    note: string;
  };
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

const taskStatusLabels: Record<ExecutionStatus, string> = {
  PENDING: "排队中",
  RUNNING: "运行中",
  DONE: "完成",
  FAILED: "失败",
  BLOCKED_EXTERNAL: "外部阻断",
  SKIPPED: "已跳过",
};

const calendarStatusLabels: Record<
  MarketCalendarSnapshot["currentStatus"],
  string
> = {
  OPEN: "交易时段内",
  CLOSED: "当前休市",
  CALENDAR_UNAVAILABLE: "日历未覆盖",
};

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

const validationDimensionLabels = [
  { key: "outOfSampleStability", label: "样本外稳定性" },
  { key: "afterCostReturn", label: "扣费后收益" },
  { key: "maxDrawdown", label: "最大回撤" },
  { key: "executionFeasibility", label: "成交可行性" },
  { key: "crossEnvironmentRobustness", label: "跨环境稳健性" },
] as const;

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
        <Badge key={id} variant="outline">
          <code>{id}</code>
        </Badge>
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
            <li key={`${label}-${index}`}>
              <Item
                className="min-w-0 flex-col items-stretch gap-1.5"
                variant="muted"
              >
                <p className="break-words text-sm">{item.text}</p>
                <EvidenceIds ids={item.evidenceIds} />
              </Item>
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
  const renderEvents = (events: ReportEvent[]) =>
    events.length ? (
      <ul className="flex min-w-0 flex-col gap-3">
        {events.map((event) => (
          <li
            key={`${event.category}-${event.occurredAtMs}-${event.evidenceIds[0]}`}
          >
            <Item
              className="min-w-0 flex-col items-stretch gap-1.5"
              variant="muted"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{event.marketCode ?? "美日"}</Badge>
                <Badge variant="secondary">{event.category}</Badge>
                <time className="text-xs text-muted-foreground">
                  {formatTime(event.occurredAtMs, report.timeZone)}
                </time>
              </div>
              <p className="break-words text-sm">{event.summary}</p>
              <EvidenceIds ids={event.evidenceIds} />
            </Item>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">
        没有可核验的已保存事件记录；这不代表没有事件。
      </p>
    );

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
              <Alert variant="destructive">
                <AlertDescription>
                  晨报应包含五行摘要；当前记录 {report.marketSummary.length}{" "}
                  行。
                </AlertDescription>
              </Alert>
            ) : null}
            {report.marketSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                没有已保存的摘要；缺失内容保持未核验。
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {report.marketSummary.map((line, index) => (
                  <li key={`summary-${index}`}>
                    <Item
                      className="min-w-0 flex-col items-stretch gap-1.5"
                      variant="muted"
                    >
                      <p className="break-words text-sm">
                        <span className="mr-2 font-medium text-muted-foreground">
                          {index + 1}.
                        </span>
                        {line.text}
                      </p>
                      <EvidenceIds ids={line.evidenceIds} />
                    </Item>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <Collapsible>
            <CollapsibleTrigger
              render={
                <Button className="w-full justify-between" variant="outline" />
              }
            >
              交易日历与已保存事件
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Separator />
              <div className="flex min-w-0 flex-col gap-5 p-4">
                <section className="flex flex-col gap-3">
                  <h4 className="text-sm font-semibold">交易日历快照</h4>
                  <ul className="flex min-w-0 flex-col gap-3">
                    {report.marketCalendars.map((calendar) => (
                      <li key={calendar.exchange}>
                        <Item
                          className="flex min-w-0 flex-col items-stretch gap-2"
                          variant="muted"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="text-sm font-medium">
                              {calendar.exchange} · {calendar.marketCode}
                            </h5>
                            <Badge variant="outline">
                              {calendarStatusLabels[calendar.currentStatus]}
                            </Badge>
                          </div>
                          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                            <Definition label="市场当前日期">
                              {calendar.date} · {calendar.timeZone}
                              {calendar.currentReason
                                ? ` · ${calendar.currentReason}`
                                : ""}
                            </Definition>
                            <Definition label="最近已完成交易日">
                              {calendar.latestCompletedDate ?? "无法核验"}
                            </Definition>
                            <Definition label="日历版本">
                              <code>{calendar.calendarVersion}</code>
                            </Definition>
                            <Definition label="快照核对时间">
                              {calendar.checkedAt}
                            </Definition>
                          </dl>
                          <ul className="flex flex-wrap gap-3 text-sm">
                            {calendar.sourceUrls.map((url) => {
                              const safeUrl = safeSourceUrl(url);
                              return safeUrl ? (
                                <li key={url}>
                                  <a
                                    className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                    href={safeUrl}
                                    rel="noreferrer noopener"
                                    target="_blank"
                                  >
                                    官方日历来源
                                  </a>
                                </li>
                              ) : null;
                            })}
                          </ul>
                        </Item>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      最近 24 小时已发生
                    </h4>
                    <Badge variant="outline">NOT_VERIFIED</Badge>
                  </div>
                  {renderEvents(report.eventTimeline.recentEvents)}
                </section>
                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      未来 24 小时已安排
                    </h4>
                    <Badge variant="outline">NOT_VERIFIED</Badge>
                  </div>
                  {renderEvents(report.eventTimeline.upcoming24hEvents)}
                  <p className="text-sm text-muted-foreground">
                    {report.eventTimeline.note}
                  </p>
                </section>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <section
            aria-labelledby={`risk-${report.id}`}
            className="flex flex-col gap-3"
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
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
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
              <Alert variant="destructive">
                <AlertDescription>
                  未记录确定性裁决；裁决缺失不等于通过。
                </AlertDescription>
              </Alert>
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
                    variant="outline"
                  />
                }
              >
                证据与研究判断
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Separator />
                <div className="flex min-w-0 flex-col gap-5 p-4">
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
                    variant="outline"
                  />
                }
              >
                策略候选（{report.candidates.length} / 3）
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Separator />
                <div className="p-4">
                  {candidateLimitExceeded ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        报告含 {report.candidates.length} 个候选，超过 3
                        个上限；为避免误用，本页不展示该组候选。
                      </AlertDescription>
                    </Alert>
                  ) : report.candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      没有满足条件的候选；不为凑数生成策略。
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-4">
                      {report.candidates.map((candidate, index) => (
                        <li className="min-w-0" key={candidate.id}>
                          <Item
                            className="min-w-0 flex-col items-stretch gap-3"
                            variant="muted"
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
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>五维验证状态</TableHead>
                                  <TableHead>当前状态</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {validationDimensionLabels.map(
                                  ({ key, label }) => (
                                    <TableRow key={key}>
                                      <TableCell>{label}</TableCell>
                                      <TableCell>
                                        <Badge variant="outline">
                                          未验证 ·{" "}
                                          {candidate.validationDimensions[key]}
                                        </Badge>
                                      </TableCell>
                                    </TableRow>
                                  ),
                                )}
                              </TableBody>
                            </Table>
                            <div className="mt-3 flex flex-col gap-3">
                              <EvidenceIds ids={candidate.evidenceIds} />
                              <div>
                                <h5 className="text-xs font-medium text-muted-foreground">
                                  待验证事项
                                </h5>
                                {candidate.unresolvedQuestions.length ? (
                                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
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
                          </Item>
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
                    variant="outline"
                  />
                }
              >
                六角色审计
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Separator />
                <ol className="flex flex-col gap-3 p-4">
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
                    variant="outline"
                  />
                }
              >
                来源覆盖、限制与账本状态
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Separator />
                <div className="flex min-w-0 flex-col gap-5 p-4">
                  <section className="flex flex-col gap-3">
                    <h4 className="text-sm font-semibold">
                      来源覆盖 ({report.sourceCoverage.length})
                    </h4>
                    {report.sourceCoverage.length ? (
                      <ul className="flex min-w-0 flex-col gap-3">
                        {report.sourceCoverage.map((source) => {
                          const sourceUrl = safeSourceUrl(source.url);
                          return (
                            <li key={source.id}>
                              <Item
                                className="flex min-w-0 flex-col items-stretch gap-2"
                                variant="muted"
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
                              </Item>
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
                      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
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

          <Separator />
          <section className="flex flex-col gap-1">
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
    ...report.marketCalendars.flatMap((calendar) => [
      calendar.exchange,
      calendar.date,
      calendar.latestCompletedDate ?? "",
      ...calendar.sourceUrls,
    ]),
    ...report.eventTimeline.recentEvents.map(({ summary }) => summary),
    ...report.eventTimeline.upcoming24hEvents.map(({ summary }) => summary),
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
  tasks,
  filters,
  taskNotice,
  enqueueError,
}: {
  reports: ResearchReport[];
  tasks: TaskRunQueueItem[];
  filters: ReportFilters;
  taskNotice: {
    id: string;
    status: ExecutionStatus;
    resultCode: string | null;
  } | null;
  enqueueError: boolean;
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
        <h1 className="sr-only">晨报与策略研究</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          阅读已保存的报告、证据和六角色审计。研究候选不代表已验证策略、获批计划或模拟成交。
        </p>
      </header>

      <section aria-labelledby="report-generation-heading">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="report-generation-heading">生成研究报告</h2>
            </CardTitle>
            <CardDescription>
              报告由本机 Worker 处理并保存到本机数据库。行情或证据不足时只归档
              NOT_VERIFIED 报告，不生成策略候选。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/v1/reports" method="post">
              <input name="requestId" type="hidden" value={randomUUID()} />
              <div className="flex flex-wrap gap-2">
                <Button name="type" type="submit" value="MORNING">
                  生成晨报
                </Button>
                <Button name="type" type="submit" value="ANOMALY">
                  生成异常报告
                </Button>
                <Button name="type" type="submit" value="DAILY_AUDIT">
                  生成日度审计
                </Button>
                <Button name="type" type="submit" value="WEEKLY_AUDIT">
                  生成周度审计
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      {enqueueError ? (
        <Alert role="alert" variant="destructive">
          <AlertTitle>报告任务未加入队列</AlertTitle>
          <AlertDescription>
            本机队列暂时不可用。没有生成或保存报告，请检查本机数据库后重试。
          </AlertDescription>
        </Alert>
      ) : null}

      {taskNotice ? (
        <Alert role="status">
          <AlertTitle>报告任务{taskStatusLabels[taskNotice.status]}</AlertTitle>
          <AlertDescription>
            <p>任务编号：{taskNotice.id}</p>
            <p>
              {taskNotice.status === "PENDING"
                ? "任务已在本机队列中等待 Worker 处理；报告尚未生成。"
                : taskNotice.status === "RUNNING"
                  ? "本机 Worker 正在处理；报告完成后刷新本页查看归档。"
                  : taskNotice.status === "DONE"
                    ? "任务已结束；归档报告显示在下方。"
                    : "任务未产生可用报告；查看状态码并修复阻断后重新生成。"}
            </p>
            {taskNotice.resultCode ? (
              <code>{taskNotice.resultCode}</code>
            ) : null}
            <p>
              <Link className="underline underline-offset-4" href="/tasks">
                查看完整任务队列
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-labelledby="report-tasks-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold" id="report-tasks-heading">
            报告任务
          </h2>
          <Link className="text-sm underline underline-offset-4" href="/tasks">
            管理全部任务
          </Link>
        </div>
        <Table>
          <TableCaption>
            最近的本机报告任务；状态保存在本机数据库。
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">任务</TableHead>
              <TableHead scope="col">状态</TableHead>
              <TableHead scope="col">创建时间（JST）</TableHead>
              <TableHead scope="col">结果</TableHead>
              <TableHead scope="col">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={5}>
                  暂无报告任务
                </TableCell>
              </TableRow>
            ) : (
              tasks.slice(0, 10).map((task) => {
                const canCancel =
                  (task.executionStatus === "PENDING" ||
                    task.executionStatus === "RUNNING") &&
                  task.cancellationRequestedAtMs === null;

                return (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          href={`/reports?task=${encodeURIComponent(task.id)}`}
                        >
                          {task.label}
                        </Link>
                        <code
                          className="text-xs text-muted-foreground"
                          title={task.id}
                        >
                          {task.id.slice(0, 8)}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {task.cancellationRequestedAtMs !== null &&
                        task.executionStatus === "RUNNING"
                          ? "停止请求中"
                          : taskStatusLabels[task.executionStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatTime(task.createdAtMs, "Asia/Tokyo")}
                    </TableCell>
                    <TableCell>
                      {(task.errorCode ?? task.resultCode) ? (
                        <code>{task.errorCode ?? task.resultCode}</code>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {canCancel ? (
                        <CancelTaskButton label={task.label} taskId={task.id} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </section>

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
                    <InputGroup>
                      <InputGroupInput
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
                      <SelectTrigger className="w-full" id="report-type">
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
                  <Button type="submit">应用筛选</Button>
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
                  暂无已归档报告。选择上方报告类型可将任务加入本机队列；Worker
                  完成前不会显示报告，也不会生成演示策略评分或绩效数字。
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
          <div className="flex flex-col gap-6">
            {[...new Set(matchingReports.map((report) => report.type))].map(
              (type) => {
                const typeReports = matchingReports.filter(
                  (report) => report.type === type,
                );

                return (
                  <section
                    aria-label={reportTypeLabels[type]}
                    className="flex flex-col gap-3"
                    key={type}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">
                        {reportTypeLabels[type]}
                      </p>
                      <Badge variant="outline">{typeReports.length} 份</Badge>
                    </div>
                    <ol className="flex flex-col gap-4">
                      {typeReports.map((report) => (
                        <ReportCard key={report.id} report={report} />
                      ))}
                    </ol>
                  </section>
                );
              },
            )}
          </div>
        )}
      </section>
    </div>
  );
}
