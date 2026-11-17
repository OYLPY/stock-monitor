import { Database } from "lucide-react";

import { Badge } from "@/components/shadcn/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shadcn/empty";

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          本地研究空间
        </p>
        <h1
          className="scroll-mt-6 text-2xl font-semibold tracking-tight sm:text-3xl"
          id="main-content"
          tabIndex={-1}
        >
          工作台总览
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          查看美日市场研究状态。研究结果只会在来源可核验后呈现。
        </p>
      </div>

      <section
        aria-labelledby="market-data-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold" id="market-data-heading">
              市场与研究数据
            </h2>
            <p className="text-sm text-muted-foreground">
              行情、新闻和策略结果将在来源接入后显示。
            </p>
          </div>
          <Badge variant="outline">NOT_VERIFIED</Badge>
        </div>

        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Database aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h3>尚未接入可核验的数据源</h3>
            </EmptyTitle>
            <EmptyDescription>
              <p>
                当前没有行情、新闻或策略记录。系统不会用示例价格或模拟收益填充此页面。
              </p>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    </div>
  );
}
