import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/alert";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/shadcn/empty";
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
import { LocalDesktopNotifications } from "@/components/tasks/local-desktop-notifications";
import {
  listNotificationDecisions,
  listNotifications,
  type AlertEvidence,
} from "@/features/alerts/alerts";
import { listTaskRuns, readWorkerStatus } from "@/features/task-queue/queue";
import type { TaskRunStatus } from "@/features/task-queue/types";

export const metadata: Metadata = { title: "任务与通知 | 量化研究工作台" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const statusLabels: Record<TaskRunStatus, string> = {
  PENDING: "排队中",
  RUNNING: "运行中",
  DONE: "已完成",
  FAILED: "失败",
  BLOCKED_EXTERNAL: "外部阻断",
  SKIPPED: "已跳过",
};

const decisionLabels: Record<string, string> = {
  BASELINED: "首次扫描基线",
  SUPPRESSED: "未提醒",
  ALREADY_NOTIFIED: "已提醒",
  SELECTED: "已提醒",
  DEFERRED_LIMIT: "超过本轮上限",
};

const decisionReasonLabels: Record<string, string> = {
  ALREADY_NOTIFIED: "同一事件修订已提醒",
  EVIDENCE_CONFLICT: "来源证据存在冲突",
  EVENT_NOT_VERIFIED: "事件事实或数据等级未核验",
  FIRST_SCAN_BASELINE: "首次完整扫描只建立基线",
  IMPORTANCE_NOT_RULED: "没有匹配的重大性规则",
  LATE_OR_UNDATED: "发布时间缺失、过期或晚于扫描时间",
  LIMIT_EXCEEDED: "本轮最多提醒三项",
  NEW_MAJOR_EVENT: "符合已核验来源与重大性规则",
  NON_MAJOR_REVISION: "来源补充或修订未改变重大性规则",
  SOURCE_NOT_AUTHORIZED: "没有已核验许可的权威来源",
};

const confidenceLabels: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

const evidenceRelationLabels: Record<string, string> = {
  SUPPORTS: "支持",
  CONTRADICTS: "反驳",
  CONTEXT: "背景",
};

const sourceRoleLabels: Record<string, string> = {
  REGULATORY_PRIMARY: "监管主来源",
  EXCHANGE_PRIMARY: "交易所主来源",
  ISSUER_PRIMARY: "公司主来源",
  AUTHORIZED_VENDOR: "授权数据商",
  SECONDARY: "二级来源",
  FIXTURE: "测试数据",
  UNKNOWN: "未知来源",
};

const licenseLabels: Record<string, string> = {
  VERIFIED: "许可已核验",
  NOT_VERIFIED: "许可未核验",
  UNKNOWN: "许可未知",
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

function formatTime(value: number | null) {
  return value === null ? "—" : timeFormatter.format(value);
}

function SourceEvidenceList({ sources }: { sources: AlertEvidence[] }) {
  if (sources.length === 0) return "—";

  return (
    <ul>
      {sources.map((source) => (
        <li key={source.source_record_id}>
          <div className="flex flex-col gap-1">
            {source.canonical_url ? (
              <Link
                href={source.canonical_url}
                rel="noreferrer"
                target="_blank"
              >
                {source.publisher}
              </Link>
            ) : (
              <span>{source.publisher}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {source.source_key} ·{" "}
              {sourceRoleLabels[source.authority_role] ?? source.authority_role}{" "}
              · {licenseLabels[source.license_status] ?? source.license_status}{" "}
              · {evidenceRelationLabels[source.relation] ?? source.relation}
            </span>
            <span className="text-xs text-muted-foreground">
              发布 {formatTime(source.published_at_ms)} · 收录{" "}
              {formatTime(source.collected_at_ms)}
            </span>
            <code className="text-xs text-muted-foreground">
              {source.source_record_id}
            </code>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ marketWatch?: string }>;
} = {}) {
  const query = searchParams ? await searchParams : {};
  const database = await openDatabase(getLocalDatabasePath());
  try {
    const tasks = listTaskRuns(database);
    const notifications = listNotifications(database);
    const decisions = listNotificationDecisions(database);
    const worker = readWorkerStatus(database);

    return (
      <div className="flex min-w-0 flex-col gap-6">
        <h1 className="sr-only">任务与通知</h1>
        {query.marketWatch === "error" ? (
          <Alert className="mb-4" variant="destructive">
            <AlertTitle>市场扫描任务未加入队列</AlertTitle>
            <AlertDescription>
              请确认本机存储可用后重试；未成功入队的请求不会显示为已运行。
            </AlertDescription>
          </Alert>
        ) : null}
        <section aria-labelledby="notifications-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="notifications-heading">
              市场提醒
            </h2>
            <div className="flex items-center gap-3">
              <LocalDesktopNotifications
                latestNotification={
                  notifications[0]
                    ? {
                        createdAtMs: notifications[0].created_at_ms,
                        id: notifications[0].id,
                      }
                    : null
                }
              />
              <Badge variant="outline">{notifications.length} 条本机提醒</Badge>
              <form action="/api/v1/market-watch" method="post">
                <input name="requestId" type="hidden" value={randomUUID()} />
                <Button type="submit">运行市场扫描</Button>
              </form>
            </div>
          </div>

          <Alert className="mb-4">
            <AlertTitle>提醒只使用可核验的新重大事件</AlertTitle>
            <AlertDescription>
              当前股票报价与成交量来源尚未核验。没有提醒不代表市场没有异常；来源缺失、标题未评估重大性或首次扫描只会记录状态，不会生成通知。
            </AlertDescription>
          </Alert>

          {notifications.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  <h3>暂无已核验提醒</h3>
                </EmptyTitle>
                <EmptyDescription>
                  <p>
                    市场扫描只在交易时段检查官方来源。满足来源、发布时间和重大性门槛后，提醒才会保存在这里。
                  </p>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{notifications.length} 条最近提醒</CardTitle>
                <CardDescription>
                  本机 SQLite 中已保存的事件、来源置信级和规则理由。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableCaption>
                    最近 50 条本机重大事件提醒，时间为日本时间（JST）。
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">市场</TableHead>
                      <TableHead scope="col">事件与依据</TableHead>
                      <TableHead scope="col">来源置信级</TableHead>
                      <TableHead scope="col">来源证据</TableHead>
                      <TableHead scope="col">来源发布时间</TableHead>
                      <TableHead scope="col">扫描任务</TableHead>
                      <TableHead scope="col">提醒时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifications.map((notification) => (
                      <TableRow key={notification.id}>
                        <TableCell>
                          {notification.market_code === "JP"
                            ? "日本"
                            : notification.market_code === "US"
                              ? "美国"
                              : "市场级"}
                        </TableCell>
                        <TableCell className="max-w-[28rem] whitespace-normal">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">
                              {notification.summary}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {notification.importance_reason}
                            </span>
                            <code className="text-xs text-muted-foreground">
                              {notification.importance_rule_id}
                            </code>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="secondary">
                              {notification.confidence_level === null
                                ? "不确定"
                                : (confidenceLabels[
                                    notification.confidence_level
                                  ] ?? notification.confidence_level)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {notification.supporting_source_count} 个独立来源
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <SourceEvidenceList sources={notification.sources} />
                        </TableCell>
                        <TableCell>
                          {formatTime(notification.published_at_ms)}
                        </TableCell>
                        <TableCell>
                          <code title={notification.task_run_id}>
                            {notification.task_run_id.slice(0, 8)}
                          </code>
                        </TableCell>
                        <TableCell>
                          {formatTime(notification.created_at_ms)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>

        <section aria-labelledby="alert-decisions-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2
              className="text-base font-semibold"
              id="alert-decisions-heading"
            >
              提醒筛选记录
            </h2>
            <p className="text-sm text-muted-foreground">
              {decisions.length} 条本机决策
            </p>
          </div>

          {decisions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  <h3>暂无筛选记录</h3>
                </EmptyTitle>
                <EmptyDescription>
                  <p>扫描到事件后，会在这里记录提醒、抑制或首次基线的原因。</p>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{decisions.length} 条最近筛选</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableCaption>
                    最近 100 条提醒筛选记录，时间为日本时间（JST）。
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">事件</TableHead>
                      <TableHead scope="col">决策</TableHead>
                      <TableHead scope="col">原因</TableHead>
                      <TableHead scope="col">来源证据</TableHead>
                      <TableHead scope="col">排序依据</TableHead>
                      <TableHead scope="col">规则版本</TableHead>
                      <TableHead scope="col">扫描任务</TableHead>
                      <TableHead scope="col">记录时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decisions.map((decision) => (
                      <TableRow key={decision.id}>
                        <TableCell className="max-w-[24rem] whitespace-normal">
                          <div className="flex flex-col gap-1">
                            <span>{decision.summary}</span>
                            <code className="text-xs text-muted-foreground">
                              {decision.event_id.slice(0, 8)}
                            </code>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {decisionLabels[decision.outcome] ??
                              decision.outcome}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {decisionReasonLabels[decision.reason_code] ??
                            decision.reason_code}
                        </TableCell>
                        <TableCell>
                          <SourceEvidenceList sources={decision.sources} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span>
                              {decision.priority_rank === null
                                ? "未参与排序"
                                : `第 ${decision.priority_rank} 位`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {decision.open_market_priority === null
                                ? "开市状态未知"
                                : decision.open_market_priority === 1
                                  ? "市场开市优先"
                                  : "市场未开市"}
                              {` · ${decision.priority_source_count ?? 0} 个来源`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {`发布时间 ${formatTime(decision.priority_published_at_ms)}`}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code>{decision.rule_version}</code>
                        </TableCell>
                        <TableCell>
                          <code title={decision.task_run_id}>
                            {decision.task_run_id.slice(0, 8)}
                          </code>
                        </TableCell>
                        <TableCell>
                          {formatTime(decision.decided_at_ms)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>

        <section aria-labelledby="task-queue-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="task-queue-heading">
              任务队列
            </h2>
            <Badge variant="outline">
              本机 Worker {worker.running ? "运行中" : "未运行"}
            </Badge>
          </div>

          {!worker.running ? (
            <p className="mb-4 text-sm text-muted-foreground" role="status">
              重新启动应用后，本机 Worker 会自动运行并处理队列。
            </p>
          ) : null}

          {tasks.length === 0 ? (
            <Empty className="min-h-48">
              <EmptyHeader>
                <EmptyTitle>队列为空</EmptyTitle>
                <EmptyDescription>
                  新建的研究报告和市场扫描会显示在这里。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{tasks.length} 条最近任务</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableCaption>
                    最近 100 条本机任务记录，时间为日本时间（JST）。
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">任务</TableHead>
                      <TableHead scope="col">状态</TableHead>
                      <TableHead scope="col">创建时间</TableHead>
                      <TableHead scope="col">开始时间</TableHead>
                      <TableHead scope="col">结束时间</TableHead>
                      <TableHead scope="col">尝试次数</TableHead>
                      <TableHead scope="col">结果</TableHead>
                      <TableHead scope="col">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => {
                      const canCancel =
                        (task.executionStatus === "PENDING" ||
                          task.executionStatus === "RUNNING") &&
                        task.cancellationRequestedAtMs === null;
                      const resultCode = task.errorCode ?? task.resultCode;

                      return (
                        <TableRow key={task.id}>
                          <TableCell className="max-w-48 whitespace-normal">
                            <div className="flex flex-col gap-1">
                              {task.kind === "REPORT" ? (
                                <Link
                                  className="font-medium underline-offset-4 hover:underline"
                                  href={`/reports?task=${encodeURIComponent(task.id)}`}
                                >
                                  {task.label}
                                </Link>
                              ) : (
                                <span className="font-medium">
                                  {task.label}
                                </span>
                              )}
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
                                : statusLabels[task.executionStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatTime(task.createdAtMs)}</TableCell>
                          <TableCell>{formatTime(task.startedAtMs)}</TableCell>
                          <TableCell>{formatTime(task.finishedAtMs)}</TableCell>
                          <TableCell>{task.attemptCount}</TableCell>
                          <TableCell>
                            {resultCode ? <code>{resultCode}</code> : "—"}
                          </TableCell>
                          <TableCell>
                            {canCancel ? (
                              <CancelTaskButton
                                label={task.label}
                                taskId={task.id}
                              />
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    );
  } finally {
    database.client.close();
  }
}
