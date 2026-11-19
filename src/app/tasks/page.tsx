import type { Metadata } from "next";
import Link from "next/link";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { Badge } from "@/components/shadcn/badge";
import {
  Card,
  CardContent,
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

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

function formatTime(value: number | null) {
  return value === null ? "—" : timeFormatter.format(value);
}

export default async function TasksPage() {
  const database = await openDatabase(getLocalDatabasePath());
  try {
    const tasks = listTaskRuns(database);
    const worker = readWorkerStatus(database);

    return (
      <div className="flex min-w-0 flex-col gap-6">
        <h1 className="sr-only">任务与通知</h1>
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
