import type { Metadata } from "next";

import { Badge } from "@/components/shadcn/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";

export const metadata: Metadata = { title: "任务与通知 | 量化研究工作台" };

const unavailableGroups = [
  {
    id: "task-runtime",
    title: "任务运行",
    records: [
      { label: "后台任务运行时", description: "任务状态尚未持久化。" },
      { label: "执行日志", description: "生产执行日志尚未接入。" },
    ],
  },
  {
    id: "local-notifications",
    title: "通知",
    records: [
      { label: "本机通知", description: "通知记录与已读状态尚未接入。" },
    ],
  },
];

export default function TasksPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="sr-only">任务与通知</h1>
        <p className="text-sm text-muted-foreground">
          当前版本没有生产任务运行时或通知存储，无法判断任务和通知数量。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {unavailableGroups.map(({ id, records, title }) => (
          <Card aria-labelledby={`${id}-heading`} key={id}>
            <CardHeader>
              <CardTitle>
                <h2 id={`${id}-heading`}>{title}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                {records.map(({ description, label }) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                    key={label}
                  >
                    <div>
                      <dt className="text-sm font-medium">{label}</dt>
                      <dd className="mt-1 text-sm text-muted-foreground">
                        {description}
                      </dd>
                    </div>
                    <Badge variant="outline">NOT_VERIFIED</Badge>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
