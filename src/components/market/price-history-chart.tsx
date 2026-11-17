"use client";

import { useId } from "react";
import { Database } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  MarketDataStatusBadge,
  type MarketDataStatus,
} from "@/components/market/market-data-status";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/shadcn/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shadcn/empty";
import { Button } from "@/components/shadcn/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import type { CurrencyCode, MarketCode } from "@/domain/primitives";
import { MARKET_TIME_ZONES } from "@/domain/primitives";

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

const chartConfig = {
  close: {
    label: "收盘价",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

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
  const descriptionId = useId();
  const timeZone = MARKET_TIME_ZONES[market];
  const latestPoint = points.at(-1);

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

  return (
    <Card aria-labelledby={headingId} className="min-w-0">
      <CardHeader>
        <div>
          <CardTitle>
            <h3 id={headingId}>{marketLabel}收盘价历史</h3>
          </CardTitle>
          <CardDescription>
            {points.length > 0
              ? points.length +
                " 条记录 · " +
                timeZone +
                " · " +
                currency +
                " / 股"
              : "时区：" + timeZone + " · 标价单位：" + currency + " / 股"}
          </CardDescription>
        </div>
        <CardAction>
          <MarketDataStatusBadge status={dataStatus} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {metadata}
        {points.length === 0 ? (
          <Empty>
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
        ) : (
          <>
            <figure
              aria-describedby={descriptionId}
              aria-labelledby={headingId}
              className="min-w-0"
              role="img"
            >
              <ChartContainer config={chartConfig} className="min-h-56 w-full">
                <LineChart
                  accessibilityLayer
                  data={points}
                  margin={{ left: 8, right: 12 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="marketAtMs"
                    minTickGap={24}
                    tickFormatter={(value: number) =>
                      formatMarketTimestamp(value, market, {
                        month: "2-digit",
                        day: "2-digit",
                      })
                    }
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    axisLine={false}
                    tickFormatter={(value: number) =>
                      formatPrice(value, currency)
                    }
                    tickLine={false}
                    width={88}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          formatPrice(Number(value), currency)
                        }
                        labelFormatter={(value) =>
                          formatMarketTimestamp(Number(value), market, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }) +
                          " " +
                          timeZone
                        }
                      />
                    }
                  />
                  <Line
                    activeDot={false}
                    dataKey="close"
                    dot={points.length === 1}
                    stroke="var(--color-close)"
                    strokeWidth={2}
                    type="monotone"
                  />
                </LineChart>
              </ChartContainer>
              <figcaption
                className="mt-2 text-xs text-muted-foreground"
                id={descriptionId}
              >
                收盘价序列；所有时间按 {timeZone}{" "}
                显示。详细记录可在数据表中查看。
              </figcaption>
            </figure>

            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    className="w-full justify-between"
                    variant="outline"
                  />
                }
              >
                查看图表数据表（{points.length} 条）
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div
                  aria-label={marketLabel + "收盘价历史数据表"}
                  className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 [&>[data-slot=table-container]]:w-max [&>[data-slot=table-container]]:overflow-visible"
                  role="region"
                  tabIndex={0}
                >
                  <Table className="min-w-[32rem]">
                    <TableCaption>
                      {marketLabel}收盘价历史，币种 {currency}，时区 {timeZone}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">市场时间</TableHead>
                        <TableHead className="text-right" scope="col">
                          收盘价（{currency} / 股）
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {points.map(({ marketAtMs, close }) => (
                        <TableRow key={marketAtMs}>
                          <TableCell>
                            <time dateTime={new Date(marketAtMs).toISOString()}>
                              {formatMarketTimestamp(marketAtMs, market, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </time>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatPrice(close, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}
