import { Badge } from "@/components/shadcn/badge";
import { Card, CardContent } from "@/components/shadcn/card";

const statusDetails = [
  {
    status: "REAL",
    label: "来源已记录",
    description: "来源已记录；不代表实时、完整或准确。",
  },
  {
    status: "DELAYED",
    label: "延迟行情",
    description: "来源明确声明该数据存在延迟。",
  },
  {
    status: "HISTORICAL",
    label: "历史行情",
    description: "数据属于已经结束的市场时段。",
  },
  {
    status: "FIXTURE",
    label: "演示数据",
    description: "合成数据仅用于界面或流程演示，不是市场事实。",
  },
  {
    status: "NOT_VERIFIED",
    label: "未核验",
    description: "来源或数据性质尚未核验，不能作为行情事实。",
  },
] as const;

export type MarketDataStatus = (typeof statusDetails)[number]["status"];

export function MarketDataStatusBadge({
  status,
}: {
  status: MarketDataStatus;
}) {
  const details = statusDetails.find((item) => item.status === status)!;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge data-status={status} variant="outline">
        {details.label}
      </Badge>
      {status === "FIXTURE" && <Badge variant="secondary">仅供演示</Badge>}
    </span>
  );
}

export function MarketDataStatusLegend() {
  return (
    <section
      aria-labelledby="market-data-status-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold" id="market-data-status-heading">
          数据状态说明
        </h2>
        <p className="text-sm text-muted-foreground">
          状态按来源和数据性质逐条标注；历史日线不代表实时行情或策略验证。
        </p>
      </div>
      <Card>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {statusDetails.map(({ description, status }) => (
              <div className="flex flex-col gap-2" key={status}>
                <dt>
                  <MarketDataStatusBadge status={status} />
                </dt>
                <dd className="text-sm leading-5 text-muted-foreground">
                  {description}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
