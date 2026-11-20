import { ChartNoAxesCombined } from "lucide-react";

import { Alert, AlertDescription } from "@/components/shadcn/alert";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Separator } from "@/components/shadcn/separator";
import { LocalCsvImport } from "@/components/market/local-csv-import";
import { LocalPriceHistory } from "@/components/market/local-price-history";
import { MarketDataStatusBadge } from "@/components/market/market-data-status";
import { PriceHistoryChart } from "@/components/market/price-history-chart";
import { UsMarketData } from "@/components/market/us-market-data";
import type { CurrencyCode, MarketCode } from "@/domain/primitives";
import { MARKET_TIME_ZONES } from "@/domain/primitives";
import {
  latestCompletedMarketSessionAt,
  marketCalendarStateAt,
} from "@/features/market-calendar/market-calendar";
import { loadLocalMarketBars } from "@/features/market-data/local-import";
import { loadEodhdDailyStatus } from "@/features/market-data/us-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const markets = [
  { code: "US", label: "美股", currency: "USD" },
  { code: "JP", label: "日股", currency: "JPY" },
] as const satisfies ReadonlyArray<{
  code: MarketCode;
  currency: CurrencyCode;
  label: string;
}>;

function calendarSummary(market: MarketCode, nowMs: number) {
  const exchanges =
    market === "US" ? (["NYSE", "NASDAQ"] as const) : (["TSE"] as const);
  const states = exchanges.map((exchange) =>
    marketCalendarStateAt(exchange, nowMs),
  );
  const latestSessions = exchanges.map((exchange) =>
    latestCompletedMarketSessionAt(exchange, nowMs),
  );
  const dates = new Set(latestSessions.map((session) => session?.date ?? null));
  const statuses = new Set(states.map(({ status }) => status));
  const reasons = new Set(states.map(({ reason }) => reason ?? null));
  const status =
    statuses.size === 1 ? states[0].status : ("CALENDAR_UNAVAILABLE" as const);

  return {
    checkedAt: states[0].checkedAt,
    currentReason: reasons.size === 1 ? states[0].reason : undefined,
    currentStatus: status,
    latestCompletedDate:
      dates.size === 1 && !dates.has(null) ? latestSessions[0]?.date : null,
    sourceUrls: states.flatMap(({ sourceUrls }) => sourceUrls.slice(0, 1)),
  };
}

function calendarStatusLabel(
  status: ReturnType<typeof calendarSummary>["currentStatus"],
  reason: ReturnType<typeof calendarSummary>["currentReason"],
) {
  if (status === "CALENDAR_UNAVAILABLE") return "日历未覆盖";
  if (status === "OPEN") return "日历时段内";
  if (reason === "EXCHANGE_HOLIDAY") return "日历安排节假日";
  if (reason === "WEEKEND") return "日历安排周末";
  return "非日历交易时段";
}

function formatTokyo(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function currentServerTimeMs() {
  return Date.now();
}

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}) {
  const nowMs = currentServerTimeMs();
  const [localBars, providerStatus, params] = await Promise.all([
    loadLocalMarketBars(),
    loadEodhdDailyStatus(),
    searchParams,
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h1 className="sr-only">市场监测</h1>

      {params.import === "success" && (
        <Alert>
          <AlertDescription>CSV 已导入；来源仍未核验。</AlertDescription>
        </Alert>
      )}
      {params.import === "error" && (
        <Alert variant="destructive">
          <AlertDescription>
            CSV 未导入；请检查文件格式和数据行。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {markets.map(({ code, currency, label }) => {
          const marketBars = localBars[code];
          const latestSnapshot = marketBars.reduce<
            (typeof marketBars)[number] | null
          >(
            (latest, bar) =>
              latest === null || bar.collectedAtMs > latest.collectedAtMs
                ? bar
                : latest,
            null,
          );
          const chartRows = latestSnapshot
            ? marketBars
                .filter(
                  (bar) =>
                    bar.symbol === latestSnapshot.symbol &&
                    bar.sourceHash === latestSnapshot.sourceHash,
                )
                .sort((left, right) =>
                  left.tradingDate.localeCompare(right.tradingDate),
                )
            : [];
          const calendar = calendarSummary(code, nowMs);
          const sourceNames = code === "US" ? ["NYSE", "Nasdaq"] : ["JPX"];
          const sourceList = sourceNames.join(" / ");

          return (
            <Collapsible key={code}>
              <Card className="min-w-0">
                <CardHeader>
                  <div>
                    <CardTitle>
                      <h2>{label}</h2>
                    </CardTitle>
                    <CardDescription>
                      日历推算的最近已完成交易日：
                      {calendar.latestCompletedDate ?? "无法核验"} ·{" "}
                      {sourceList} 日历 · {MARKET_TIME_ZONES[code]}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Badge
                      variant={
                        calendar.currentStatus === "CALENDAR_UNAVAILABLE"
                          ? "outline"
                          : "secondary"
                      }
                    >
                      {calendarStatusLabel(
                        calendar.currentStatus,
                        calendar.currentReason,
                      )}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-3">
                  <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <dt className="text-muted-foreground">本机价格覆盖</dt>
                      <dd className="flex min-w-0 flex-col gap-1">
                        {latestSnapshot ? (
                          <>
                            <span className="break-words">
                              {latestSnapshot.symbol} ·{" "}
                              {latestSnapshot.tradingDate} · {currency} ·{" "}
                              {MARKET_TIME_ZONES[code]}
                            </span>
                            <span className="text-muted-foreground">
                              {latestSnapshot.publisher} · 采集于{" "}
                              {formatTokyo(latestSnapshot.collectedAtMs)} JST
                            </span>
                          </>
                        ) : (
                          "暂无已保存日线"
                        )}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <dt className="text-muted-foreground">数据状态</dt>
                      <dd>
                        <MarketDataStatusBadge
                          status={latestSnapshot?.dataClass ?? "NOT_VERIFIED"}
                        />
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <dt className="text-muted-foreground">下一步</dt>
                      <dd className="break-words">
                        {code === "US"
                          ? providerStatus.configured
                            ? "可按需获取 EODHD Free 近一年日线"
                            : "未配置 EODHD Free；不会发出行情请求"
                          : "没有自动行情源；CSV 仅导入本机查看"}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <dt className="text-muted-foreground">交易日历来源</dt>
                      <dd className="flex flex-wrap gap-x-2 gap-y-1">
                        {calendar.sourceUrls.map((url, index) => (
                          <a
                            className="underline underline-offset-4"
                            href={url}
                            key={url}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {sourceNames[index]}
                          </a>
                        ))}
                        <span className="text-muted-foreground">
                          核验于 {calendar.checkedAt.slice(0, 10)} UTC
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <p className="text-sm text-muted-foreground">
                    日历为静态排期，不含临时停市或行情报价；本机价格记录的时效和核验状态单独标注。
                  </p>
                </CardContent>
                <CardFooter>
                  <CollapsibleTrigger
                    render={
                      <Button
                        className="w-full justify-between"
                        variant="outline"
                      />
                    }
                  >
                    查看{label}图表与数据管理
                  </CollapsibleTrigger>
                </CardFooter>
                <CollapsibleContent className="flex min-w-0 flex-col gap-4 px-4 pb-4">
                  <Separator />
                  {code === "US" ? (
                    <UsMarketData {...providerStatus} />
                  ) : (
                    <Alert>
                      <AlertDescription>
                        日股没有已接入的自动行情源。CSV
                        只保存在本机，来源未核验，不用于回测或策略研究。
                      </AlertDescription>
                    </Alert>
                  )}

                  <Collapsible>
                    <CollapsibleTrigger
                      render={
                        <Button
                          className="w-full justify-between"
                          variant="outline"
                        />
                      }
                    >
                      导入 CSV
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                      <LocalCsvImport market={code} />
                    </CollapsibleContent>
                  </Collapsible>

                  {chartRows.length > 0 && latestSnapshot ? (
                    <PriceHistoryChart
                      collectedAtMs={latestSnapshot.collectedAtMs}
                      currency={currency}
                      dataStatus={latestSnapshot.dataClass}
                      market={code}
                      marketLabel={`${label} · ${latestSnapshot.symbol}`}
                      points={chartRows.map((bar) => ({
                        tradingDate: bar.tradingDate,
                        close: Number(bar.close),
                      }))}
                      sourceName={latestSnapshot.publisher}
                    />
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ChartNoAxesCombined aria-hidden="true" />
                        </EmptyMedia>
                        <EmptyTitle>{label}暂无日线</EmptyTitle>
                        <EmptyDescription>
                          导入本机 CSV
                          {code === "US" && providerStatus.configured
                            ? "或按需获取 EODHD Free 日线"
                            : ""}
                          后可查看图表；未核验数据不用于策略验证。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}

                  <LocalPriceHistory bars={marketBars} market={code} />
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
