import { useId } from "react";
import { Database } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MarketDataStatusBadge,
  type MarketDataStatus,
} from "@/components/market/market-data-status";
import type { CurrencyCode, MarketCode } from "@/domain/primitives";
import { MARKET_TIME_ZONES } from "@/domain/primitives";

const VIEW_BOX_WIDTH = 720;
const VIEW_BOX_HEIGHT = 280;
const PLOT_LEFT = 84;
const PLOT_RIGHT = 704;
const PLOT_TOP = 20;
const PLOT_BOTTOM = 232;
const Y_TICK_COUNT = 5;

export interface PriceHistoryPoint {
  marketAtMs: number;
  close: number;
}

interface PriceHistoryChartProps {
  collectedAtMs: number | null;
  currency: CurrencyCode;
  dataStatus: MarketDataStatus;
  market: MarketCode;
  marketLabel: string;
  points: readonly PriceHistoryPoint[];
  sourceName: string;
}

function formatMarketTimestamp(
  instantMs: number,
  market: MarketCode,
  options: Intl.DateTimeFormatOptions,
) {
  const timeZone = MARKET_TIME_ZONES[market];
  return new Intl.DateTimeFormat("zh-CN", { timeZone, ...options }).format(
    new Date(instantMs),
  );
}

function formatPrice(close: number, currency: CurrencyCode) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(close);
}

export function PriceHistoryChart({
  collectedAtMs,
  currency,
  dataStatus,
  market,
  marketLabel,
  points,
  sourceName,
}: PriceHistoryChartProps) {
  const headingId = useId();
  const svgTitleId = useId();
  const svgDescriptionId = useId();
  const latestPoint = points.at(-1);
  const timeZone = MARKET_TIME_ZONES[market];

  const metadata = (
    <dl className="grid gap-3 border-b pb-4 text-sm sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-muted-foreground">数据来源</dt>
        <dd className="break-words">{sourceName}</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-muted-foreground">标价单位</dt>
        <dd>{currency} / 股</dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-muted-foreground">市场时间</dt>
        <dd>
          {latestPoint ? (
            <time dateTime={new Date(latestPoint.marketAtMs).toISOString()}>
              {formatMarketTimestamp(latestPoint.marketAtMs, market, {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              {timeZone}
            </time>
          ) : (
            "无行情时间戳"
          )}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="text-muted-foreground">采集时间</dt>
        <dd>
          {collectedAtMs !== null ? (
            <time dateTime={new Date(collectedAtMs).toISOString()}>
              {new Intl.DateTimeFormat("zh-CN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Tokyo",
              }).format(new Date(collectedAtMs))}{" "}
              Asia/Tokyo
            </time>
          ) : (
            "无采集记录"
          )}
        </dd>
      </div>
    </dl>
  );

  if (points.length === 0) {
    return (
      <article
        aria-labelledby={headingId}
        className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold" id={headingId}>
              {marketLabel}收盘价历史
            </h3>
            <p className="text-sm text-muted-foreground">
              时区：{timeZone} · 标价单位：{currency} / 股
            </p>
          </div>
          <MarketDataStatusBadge status={dataStatus} />
        </header>
        {metadata}
        <Empty className="min-h-48 border-dashed bg-background px-4 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Database aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h4>暂无可核验的历史行情</h4>
            </EmptyTitle>
            <EmptyDescription>
              <p>
                行情来源尚未接入。没有价格序列时不绘制趋势线，也不填入示例报价。
              </p>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </article>
    );
  }

  const firstPoint = points[0]!;
  const plottedLatestPoint = points[points.length - 1]!;
  const minimum = points.reduce(
    (value, point) => Math.min(value, point.close),
    Number.POSITIVE_INFINITY,
  );
  const maximum = points.reduce(
    (value, point) => Math.max(value, point.close),
    Number.NEGATIVE_INFINITY,
  );
  const observedRange = maximum - minimum;
  const range = observedRange || Math.max(Math.abs(maximum) * 0.01, 1);
  const chartMaximum = maximum + (range - observedRange) / 2;
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const coordinates = points.map((point, index) => ({
    x:
      points.length === 1
        ? PLOT_LEFT + plotWidth / 2
        : PLOT_LEFT + (index * plotWidth) / (points.length - 1),
    y: PLOT_TOP + ((chartMaximum - point.close) / range) * plotHeight,
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  const yTicks = Array.from({ length: Y_TICK_COUNT }, (_, index) => {
    const fraction = index / (Y_TICK_COUNT - 1);
    return {
      value: chartMaximum - range * fraction,
      y: PLOT_TOP + plotHeight * fraction,
    };
  });
  return (
    <article
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold" id={headingId}>
            {marketLabel}收盘价历史
          </h3>
          <p className="text-sm text-muted-foreground">
            {points.length} 条记录 · {timeZone} · {currency} / 股
          </p>
        </div>
        <MarketDataStatusBadge status={dataStatus} />
      </header>
      {metadata}
      <figure aria-describedby={svgDescriptionId} className="min-w-0">
        <svg
          aria-labelledby={`${svgTitleId} ${svgDescriptionId}`}
          className="block h-auto w-full text-foreground"
          role="img"
          viewBox={`0 0 ${VIEW_BOX_WIDTH} ${VIEW_BOX_HEIGHT}`}
        >
          <title id={svgTitleId}>
            {marketLabel}收盘价历史图，币种 {currency}
          </title>
          <desc id={svgDescriptionId}>
            {formatMarketTimestamp(firstPoint.marketAtMs, market, {
              dateStyle: "medium",
            })}{" "}
            至{" "}
            {formatMarketTimestamp(plottedLatestPoint.marketAtMs, market, {
              dateStyle: "medium",
            })}
            ，共 {points.length} 个收盘价数据点。详细记录可展开数据表查看。
          </desc>
          <g
            className="text-muted-foreground"
            fill="currentColor"
            fontSize="12"
          >
            {yTicks.map(({ value, y }) => (
              <g key={y}>
                <line
                  className="text-border"
                  stroke="currentColor"
                  strokeDasharray="3 5"
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y}
                  y2={y}
                />
                <text textAnchor="end" x={PLOT_LEFT - 8} y={y + 4}>
                  {formatPrice(value, currency)}
                </text>
              </g>
            ))}
            <text textAnchor="start" x={PLOT_LEFT} y={PLOT_BOTTOM + 24}>
              {formatMarketTimestamp(firstPoint.marketAtMs, market, {
                month: "2-digit",
                day: "2-digit",
              })}
            </text>
            <text textAnchor="end" x={PLOT_RIGHT} y={PLOT_BOTTOM + 24}>
              {formatMarketTimestamp(plottedLatestPoint.marketAtMs, market, {
                month: "2-digit",
                day: "2-digit",
              })}
            </text>
          </g>
          {points.length === 1 ? (
            <circle
              className="fill-primary"
              cx={coordinates[0].x}
              cy={coordinates[0].y}
              r="4"
            />
          ) : (
            <path
              className="text-primary"
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <figcaption className="mt-2 text-xs text-muted-foreground">
          收盘价序列；所有时间按 {timeZone} 显示。
        </figcaption>
      </figure>
      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer rounded-sm py-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          查看图表数据表（{points.length} 条）
        </summary>
        <div className="mt-2 max-w-full overflow-x-auto">
          <table className="min-w-full border-collapse text-left">
            <caption className="sr-only">
              {marketLabel}收盘价历史，币种 {currency}，时区 {timeZone}
            </caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-2 py-2 font-medium" scope="col">
                  市场时间
                </th>
                <th className="px-2 py-2 text-right font-medium" scope="col">
                  收盘价（{currency} / 股）
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map(({ marketAtMs, close }) => (
                <tr className="border-b last:border-0" key={marketAtMs}>
                  <td className="whitespace-nowrap px-2 py-2">
                    <time dateTime={new Date(marketAtMs).toISOString()}>
                      {formatMarketTimestamp(marketAtMs, market, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">
                    {formatPrice(close, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
