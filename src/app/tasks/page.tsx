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
      {
        label: "报告任务状态",
        description: "研究报告任务已保存到本机队列；具体状态在报告页面查看。",
      },
      {
        label: "其他后台任务",
        description: "其他任务类型与通知仍未接入。",
      },
      { label: "执行日志", description: "执行日志与历史查询尚未接入。" },
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
          报告任务运行在本机 Worker；本页尚未提供任务历史或通知管理。
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
