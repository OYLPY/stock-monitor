import { MarketDataStatusBadge } from "@/components/market/market-data-status";
import { Button } from "@/components/shadcn/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/shadcn/collapsible";
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
  if (bars.length === 0) return null;

  const { currency, label } = marketDetails[market];

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button className="w-full justify-between" variant="outline" />}
      >
        查看本机行情明细（{bars.length} 条）
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <div
          aria-label={`${label}行情明细表`}
          className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 [&>[data-slot=table-container]]:w-max [&>[data-slot=table-container]]:overflow-visible"
          role="region"
          tabIndex={0}
        >
          <Table className="min-w-[64rem]">
            <TableCaption>
              {label}日线记录，价格单位 {currency}，时区{" "}
              {MARKET_TIME_ZONES[market]}。 历史行情不代表实时行情或策略验证。
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
