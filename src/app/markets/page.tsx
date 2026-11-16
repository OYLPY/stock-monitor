import { CircleHelp } from "lucide-react";

import {
  MarketDataStatusBadge,
  MarketDataStatusLegend,
} from "@/components/market/market-data-status";
import { PriceHistoryChart } from "@/components/market/price-history-chart";
import { MARKET_TIME_ZONES } from "@/domain/primitives";
import type { CurrencyCode, MarketCode } from "@/domain/primitives";

const markets = [
  { code: "US", label: "美国市场", currency: "USD" },
  { code: "JP", label: "日本市场", currency: "JPY" },
] as const satisfies ReadonlyArray<{
  code: MarketCode;
  currency: CurrencyCode;
  label: string;
}>;

export default function MarketsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">美日市场</p>
        <h1
          className="scroll-mt-6 text-2xl font-semibold tracking-tight sm:text-3xl"
          id="main-content"
          tabIndex={-1}
        >
          市场监测
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          当前未接入经过核验的交易日历或行情来源。页面不会推断开市状态，也不会用示例价格填充图表。
        </p>
      </header>

      <section
        aria-labelledby="market-sessions-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold" id="market-sessions-heading">
            市场时段与行情快照
          </h2>
          <p className="text-sm text-muted-foreground">
            时区按市场所属地区标明；交易日历和行情采集时间尚不可用。
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {markets.map(({ code, currency, label }) => (
            <article
              aria-labelledby={`market-${code}-heading`}
              className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5"
              key={code}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h3
                    className="text-base font-semibold"
                    id={`market-${code}-heading`}
                  >
                    {label}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {MARKET_TIME_ZONES[code]}
                  </p>
                </div>
                <MarketDataStatusBadge status="NOT_VERIFIED" />
              </header>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-muted-foreground">开闭市状态</dt>
                  <dd className="flex flex-col items-start gap-1">
                    <span>无法确认</span>
                    <span className="text-xs text-muted-foreground">
                      交易日历未接入
                    </span>
                  </dd>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-muted-foreground">最新行情 / 市场时间</dt>
                  <dd>无可核验快照 / 无时间戳</dd>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-muted-foreground">行情来源 / 采集时间</dt>
                  <dd>未接入 / 无采集记录</dd>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-muted-foreground">市场报价币种</dt>
                  <dd>{currency}</dd>
                </div>
              </dl>
              <p className="flex items-start gap-2 border-t pt-3 text-xs leading-5 text-muted-foreground">
                <CircleHelp
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                市场时段和价格时间须由来源确认；交易日历未接入时不根据开发机时钟推断开闭市。
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="market-history-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold" id="market-history-heading">
            收盘价历史
          </h2>
          <p className="text-sm text-muted-foreground">
            图表使用各市场当地时间；收盘价始终保留原始报价币种。
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {markets.map(({ code, currency, label }) => (
            <PriceHistoryChart
              collectedAtMs={null}
              currency={currency}
              dataStatus="NOT_VERIFIED"
              key={code}
              market={code}
              marketLabel={label}
              points={[]}
              sourceName="未接入行情来源"
            />
          ))}
        </div>
      </section>

      <MarketDataStatusLegend />
    </div>
  );
}
