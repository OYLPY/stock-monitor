import Link from "next/link";
import { Activity, Bell, FileText } from "lucide-react";

import { Badge } from "@/components/shadcn/badge";
import { buttonVariants } from "@/components/shadcn/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shadcn/empty";

const researchAreas = [
  {
    href: "/markets",
    icon: Activity,
    label: "市场监测",
    title: "尚无可核验行情",
    description: "行情来源尚未接入；不显示价格、涨跌幅或趋势图。",
    action: "查看市场监测",
  },
  {
    href: "/events",
    icon: Bell,
    label: "异常与事件",
    title: "本机暂无事件记录",
    description:
      "事件库为空不代表市场没有新事件；此处只显示已保存且有来源证据的记录。",
    action: "查看事件记录",
  },
  {
    href: "/reports",
    icon: FileText,
    label: "晨报与策略研究",
    title: "尚无已保存的报告",
    description: "报告生成与归档尚未接入；不会生成演示候选、胜率或绩效数字。",
    action: "查看研究报告",
  },
] as const;

export default function Home() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">工作台总览</h1>
      <section
        aria-label="研究工作区状态"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {researchAreas.map(
          ({ action, description, href, icon: Icon, label, title }) => (
            <article aria-labelledby={`area-${href}`} key={href}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 id={`area-${href}`}>{label}</h2>
                  </CardTitle>
                  <CardAction>
                    <Badge variant="outline">NOT_VERIFIED</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Icon aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>
                        <h3>{title}</h3>
                      </EmptyTitle>
                      <EmptyDescription>
                        <p>{description}</p>
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Link className={buttonVariants()} href={href}>
                        {action}
                      </Link>
                    </EmptyContent>
                  </Empty>
                </CardContent>
              </Card>
            </article>
          ),
        )}
      </section>
    </div>
  );
}
