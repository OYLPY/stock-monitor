import {
  Database,
  FlaskConical,
  LineChart,
  ListOrdered,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import type { PaperLedgerSnapshot } from "@/features/paper-account/paper-account-center";

export type BacktestDraft = {
  market: "" | "JP" | "US";
  instrument: string;
  interval: "" | "3600" | "86400";
  from: string;
  to: string;
  dateRangeInvalid: boolean;
};

const eventLabels: Record<string, string> = {
  ACCOUNT_OPENED: "账户开户",
  RESERVATION: "资金预留",
  RELEASE: "资金释放",
  FILL: "模拟成交",
  FEE: "费用",
  FX_CONVERSION: "模拟换汇",
  SETTLEMENT: "结算",
  CORPORATE_ACTION: "公司行为",
  REVERSAL: "冲正",
};

const bucketLabels: Record<string, string> = {
  SETTLED: "已结算",
  UNSETTLED_RECEIVABLE: "未结算应收",
  UNSETTLED_PAYABLE: "未结算应付",
};

function formatUtc(value: string) {
  return `${new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(Number(value)))} UTC`;
}

function formatCashEntry(
  amountMinor: string | null,
  currencyCode: string | null,
  currencyScale: number | null,
) {
  if (amountMinor === null || currencyCode === null || currencyScale === null) {
    return "无现金分录";
  }
  const amount = BigInt(amountMinor);
  const magnitude = amount < BigInt(0) ? -amount : amount;
  const unit = BigInt(10) ** BigInt(currencyScale);
  const whole = magnitude / unit;
  const fractional = magnitude % unit;
  const decimal =
    currencyScale === 0
      ? ""
      : `.${fractional.toString().padStart(currencyScale, "0")}`;
  return `${amount < BigInt(0) ? "−" : ""}${currencyCode} ${new Intl.NumberFormat(
    "ja-JP",
  ).format(whole)}${decimal}`;
}

function LedgerRows({
  ledger,
}: {
  ledger: Extract<PaperLedgerSnapshot, { state: "INITIALIZED" }>;
}) {
  return (
    <div
      aria-labelledby="account-heading"
      className="max-w-full overflow-x-auto rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2"
      role="region"
      tabIndex={0}
    >
      <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          纸面账本事件和现金分录；时间均为 UTC。
        </caption>
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium" scope="col">
              序号
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              账本事件
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              有效时间
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              现金分录
            </th>
            <th className="px-3 py-2 font-medium" scope="col">
              记录时间
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {ledger.entries.map((entry) => (
            <tr key={entry.cashEntryId ?? entry.eventId}>
              <td className="px-3 py-3 font-mono tabular-nums">
                {entry.sequenceNo}
              </td>
              <th className="px-3 py-3 font-medium" scope="row">
                {eventLabels[entry.eventType] ?? entry.eventType}
              </th>
              <td className="whitespace-nowrap px-3 py-3">
                {formatUtc(entry.effectiveAtMs)}
              </td>
              <td className="px-3 py-3">
                {entry.bucket
                  ? `${bucketLabels[entry.bucket] ?? entry.bucket} · ${formatCashEntry(entry.amountMinor, entry.currencyCode, entry.currencyScale)}`
                  : formatCashEntry(
                      entry.amountMinor,
                      entry.currencyCode,
                      entry.currencyScale,
                    )}
              </td>
              <td className="whitespace-nowrap px-3 py-3">
                {formatUtc(entry.recordedAtMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BacktestPaperLedger({
  draft,
  ledger,
}: {
  draft: BacktestDraft;
  ledger: PaperLedgerSnapshot;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">研究与模拟</p>
        <h1
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
          id="main-content"
          tabIndex={-1}
        >
          回测与纸面账户
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          回测只检验明确的历史假设；本地纸面账本与回测结果分开记录。本页不会连接券商或提交真实订单。
        </p>
      </header>

      <section
        aria-labelledby="parameters-heading"
        className="rounded-xl border bg-card p-4 sm:p-5"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" id="parameters-heading">
              回测参数
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              参数预览仅保存在当前地址；不会写入数据库或启动实验。
            </p>
          </div>
          <Badge variant="outline">运行引擎未接入</Badge>
        </div>
        <form action="/backtests" className="flex flex-col gap-4" method="get">
          <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <legend className="sr-only">回测参数草稿</legend>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="market">
                市场
              </label>
              <select
                className="min-h-12 rounded-md border bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
                defaultValue={draft.market}
                id="market"
                name="market"
                required
              >
                <option value="">选择市场</option>
                <option value="JP">日本</option>
                <option value="US">美国</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="instrument">
                证券标识
              </label>
              <Input
                autoCapitalize="characters"
                className="min-h-12 text-base"
                id="instrument"
                maxLength={32}
                name="instrument"
                required
                defaultValue={draft.instrument}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="interval">
                周期
              </label>
              <select
                className="min-h-12 rounded-md border bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
                defaultValue={draft.interval}
                id="interval"
                name="interval"
                required
              >
                <option value="">选择周期</option>
                <option value="86400">日线</option>
                <option value="3600">60 分钟</option>
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="from">
                开始日期
              </label>
              <Input
                className="min-h-12 text-base"
                id="from"
                max="9999-12-31"
                name="from"
                required
                type="date"
                defaultValue={draft.from}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="to">
                结束日期
              </label>
              <Input
                className="min-h-12 text-base"
                id="to"
                max="9999-12-31"
                name="to"
                required
                type="date"
                defaultValue={draft.to}
              />
            </div>
          </fieldset>
          {draft.dateRangeInvalid && (
            <p className="text-sm text-destructive" role="alert">
              开始日期不能晚于结束日期。
            </p>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            日期按所选市场解释；当前没有已核验历史行情或回测引擎。输入内容不代表证券已确认、数据已覆盖或结果可复现。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-12" type="submit">
              应用参数草稿
            </Button>
            <Button
              className="min-h-12"
              disabled
              type="button"
              variant="outline"
            >
              开始回测
            </Button>
            <span className="text-sm text-muted-foreground">
              缺少回测引擎、历史数据和版本化成本模型。
            </span>
          </div>
        </form>
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="results-heading"
          className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
        >
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="results-heading">
              实验结果
            </h2>
            <Badge variant="outline">NOT_VERIFIED</Badge>
          </header>
          <Empty className="min-h-40 border-0 px-2 py-5">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConical aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>暂无可核验的回测</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>
                  回测运行存储、历史行情、样本划分、撮合和成本模型尚未接入；不显示胜率、收益或策略评分。
                </p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </section>

        <section
          aria-labelledby="cost-risk-heading"
          className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
        >
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="cost-risk-heading">
              费用与风险边界
            </h2>
            <ShieldCheck
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          </header>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">佣金、税费、价差与滑点</dt>
              <dd className="mt-1">NOT_VERIFIED · 成本模型未接入</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">FX 成本</dt>
              <dd className="mt-1">NOT_VERIFIED · 来源与规则未接入</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">单笔预计最大损失</dt>
              <dd className="mt-1">≤ 可核验当前权益的 2%</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">峰值回撤门禁</dt>
              <dd className="mt-1">≥ 20% 时停止新增头寸</dd>
            </div>
          </dl>
          <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
            风险比例是固定系统边界，不可由页面修改。当前权益、成本或输入证据未核验时，不计算风险预算或模拟通过结论。
          </p>
        </section>

        <section
          aria-labelledby="equity-heading"
          className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
        >
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="equity-heading">
              权益曲线
            </h2>
            <Badge variant="outline">NOT_VERIFIED</Badge>
          </header>
          <Empty className="min-h-40 border-0 px-2 py-5">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LineChart aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>没有可绘制的权益快照</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>
                  缺少可复核的账本投影、持仓估值、FX
                  和时点数据，因此不绘制曲线或推算峰值回撤。
                </p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </section>

        <section
          aria-labelledby="account-heading"
          className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5"
        >
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="account-heading">
              纸面账户与账本
            </h2>
            <Badge
              variant={ledger.state === "INITIALIZED" ? "secondary" : "outline"}
            >
              {ledger.state === "INITIALIZED"
                ? "已建立"
                : ledger.state === "NOT_INITIALIZED"
                  ? "未建立"
                  : "NOT_VERIFIED"}
            </Badge>
          </header>
          {ledger.state === "NOT_INITIALIZED" ? (
            <Empty className="min-h-40 border-0 px-2 py-5">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Wallet aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  <h3>纸面账本未建立</h3>
                </EmptyTitle>
                <EmptyDescription>
                  <p>
                    本机数据库中没有已初始化的账户；不显示推算本金、余额、持仓、权益、风险预算或历史收益。
                  </p>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : ledger.state === "UNAVAILABLE" ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              本机数据库无法读取。账本、余额和风险状态均为 NOT_VERIFIED。
            </p>
          ) : (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">基准币种</dt>
                  <dd className="mt-1">{ledger.baseCurrency}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">开户时间</dt>
                  <dd className="mt-1">{formatUtc(ledger.initializedAtMs)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">当前权益 / 风险预算</dt>
                  <dd className="mt-1">NOT_VERIFIED · 估值引擎未接入</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">账本现金流水</dt>
                  <dd className="mt-1">{ledger.entries.length} 条事件记录</dd>
                </div>
              </dl>
              {ledger.entries.length > 0 ? (
                <LedgerRows ledger={ledger} />
              ) : (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  账户已建立，但没有账本事件记录。
                </p>
              )}
            </>
          )}
        </section>

        <section
          aria-labelledby="orders-heading"
          className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5 lg:col-span-2"
        >
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold" id="orders-heading">
              模拟订单状态
            </h2>
            <Badge variant="outline">NOT_VERIFIED</Badge>
          </header>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl text-sm text-muted-foreground">
              模拟订单存储、风险裁决、版本绑定批准和撮合运行时尚未接入。没有可核验订单状态；此页面不能直接写入订单或账本。
            </p>
            <Button className="min-h-12 shrink-0" disabled type="button">
              <ListOrdered aria-hidden="true" />
              创建模拟订单
            </Button>
          </div>
          <Empty className="min-h-32 border-0 px-2 py-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>订单状态不可用</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>
                  只有通过确定性风控和本地批准的模拟器订单才会出现在这里；当前没有可查询的订单存储。
                </p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </section>
      </div>
    </div>
  );
}
