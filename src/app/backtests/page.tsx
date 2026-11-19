import type { Metadata } from "next";

import { BacktestPaperLedger } from "@/components/backtests/backtest-paper-ledger";
import { loadPaperAccountLedger } from "@/features/paper-account/paper-account-center";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "回测与纸面账户 | 量化研究工作台",
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

export default async function BacktestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const rawMarket = firstValue(params.market);
  const rawInterval = firstValue(params.interval);
  const market = rawMarket === "JP" || rawMarket === "US" ? rawMarket : "";
  const defaultTab =
    firstValue(params.tab) === "account" ? "account" : "research";
  const interval =
    rawInterval === "3600" || rawInterval === "86400" ? rawInterval : "";
  const from = validDate(firstValue(params.from));
  const to = validDate(firstValue(params.to));
  const ledger = await loadPaperAccountLedger();

  return (
    <BacktestPaperLedger
      draft={{
        market,
        instrument: firstValue(params.instrument)?.trim().slice(0, 32) ?? "",
        interval,
        from,
        to,
        dateRangeInvalid: Boolean(from && to && from > to),
      }}
      ledger={ledger}
      defaultTab={defaultTab}
    />
  );
}
