import { LocalCsvImport } from "@/components/market/local-csv-import";
import { LocalPriceHistory } from "@/components/market/local-price-history";
import { PriceHistoryChart } from "@/components/market/price-history-chart";
import { UsMarketData } from "@/components/market/us-market-data";
import { ChartNoAxesCombined } from "lucide-react";
import { Alert, AlertDescription } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/shadcn/tabs";
import type { CurrencyCode, MarketCode } from "@/domain/primitives";
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

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ import?: string }>;
}) {
  const [localBars, providerStatus, params] = await Promise.all([
    loadLocalMarketBars(),
    loadEodhdDailyStatus(),
    searchParams,
  ]);

  return (
    <div className="flex flex-col gap-4">
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

      <Tabs defaultValue="US" className="min-w-0">
        <TabsList activateOnFocus aria-label="选择市场">
          {markets.map(({ code, label }) => (
            <TabsTrigger key={code} value={code}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

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

          return (
            <TabsContent
              className="flex min-w-0 flex-col gap-4"
              key={code}
              value={code}
            >
              <h2 className="sr-only">{label}行情</h2>
              {code === "US" ? (
                <UsMarketData {...providerStatus} />
              ) : (
                <Alert>
                  <AlertDescription>
                    日股自动行情源尚未接入；可导入本机 CSV，仅供查看。
                  </AlertDescription>
                </Alert>
              )}

              <Collapsible>
                <CollapsibleTrigger
                  render={<Button className="self-start" variant="outline" />}
                >
                  导入 CSV
                </CollapsibleTrigger>
                <CollapsibleContent>
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
                      {code === "US"
                        ? "获取或导入日线后会显示趋势；导入文件不用于策略验证。"
                        : "导入日线后会显示趋势；本机文件不用于策略验证。"}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              <LocalPriceHistory bars={marketBars} market={code} />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
