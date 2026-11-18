import { Database } from "lucide-react";

import { MarketDataStatusBadge } from "@/components/market/market-data-status";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shadcn/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { MARKET_TIME_ZONES } from "@/domain/primitives";
import type { MarketCode } from "@/domain/primitives";
import type { LocalMarketBarRow } from "@/features/market-data/local-import";

const marketDetails = {
  US: { label: "美国市场", currency: "USD" },
  JP: { label: "日本市场", currency: "JPY" },
} as const;

function collectedAtLabel(value: number) {
  return `${new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value))} JST`;
}

export function LocalPriceHistory({
  bars,
  market,
}: {
  bars: readonly LocalMarketBarRow[];
  market: MarketCode;
}) {
  const { currency, label } = marketDetails[market];
  const headingId = `local-price-history-${market}`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            <h3 id={headingId}>{label}本机导入行情</h3>
          </CardTitle>
          <CardDescription>
            {MARKET_TIME_ZONES[market]} · {currency} · 最多显示最近 100 条
          </CardDescription>
        </div>
        <CardAction>
          <MarketDataStatusBadge status="NOT_VERIFIED" />
        </CardAction>
      </CardHeader>
      <CardContent>
        {bars.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h4>尚无本机导入行情</h4>
              </EmptyTitle>
              <EmptyDescription>
                <p>使用上方 CSV 导入后，可在此查看日期、OHLCV 和来源状态。</p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table
            aria-labelledby={headingId}
            className="min-w-[64rem]"
            tabIndex={0}
          >
            <TableCaption>
              最近导入的 {bars.length} 条 {label}日线记录。价格单位：{currency}
              ；来源和许可尚未核验。
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead>证券</TableHead>
                <TableHead className="text-right">开盘</TableHead>
                <TableHead className="text-right">最高</TableHead>
                <TableHead className="text-right">最低</TableHead>
                <TableHead className="text-right">收盘</TableHead>
                <TableHead className="text-right">成交量</TableHead>
                <TableHead>来源 / SHA-256</TableHead>
                <TableHead>本机采集时间</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bars.map((bar) => (
                <TableRow key={`${bar.sourceHash}-${bar.tradingDate}`}>
                  <TableCell>{bar.tradingDate}</TableCell>
                  <TableCell className="font-medium">{bar.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bar.open}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bar.high}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bar.low}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bar.close}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bar.volume}
                  </TableCell>
                  <TableCell>
                    {bar.publisher} · {bar.sourceHash.slice(0, 12)}
                  </TableCell>
                  <TableCell>{collectedAtLabel(bar.collectedAtMs)}</TableCell>
                  <TableCell>
                    <MarketDataStatusBadge status={bar.dataClass} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
