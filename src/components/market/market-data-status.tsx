import { Badge } from "@/components/ui/badge";

const statusDetails = [
  { status: "REAL", description: "来自实际来源，不代表实时、完整或准确。" },
  { status: "DELAYED", description: "来源明确声明该数据存在延迟。" },
  { status: "HISTORICAL", description: "数据属于已经结束的市场时段。" },
  {
    status: "FIXTURE",
    description: "合成演示数据，验证等级必须为 DEMO_ONLY。",
  },
  {
    status: "NOT_VERIFIED",
    description: "来源或数据性质尚未核验，不能作为行情事实。",
  },
] as const;

export type MarketDataStatus = (typeof statusDetails)[number]["status"];

export function MarketDataStatusBadge({
  status,
}: {
  status: MarketDataStatus;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{status}</Badge>
      {status === "FIXTURE" && <Badge variant="secondary">DEMO_ONLY</Badge>}
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
          当前没有接入行情源；以下是状态含义，不代表已取得对应数据。
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {statusDetails.map(({ description, status }) => (
          <div
            className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3"
            key={status}
          >
            <dt>
              <MarketDataStatusBadge status={status} />
            </dt>
            <dd className="text-sm leading-5 text-muted-foreground">
              {description}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
