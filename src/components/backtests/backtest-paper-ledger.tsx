import {
  Database,
  FlaskConical,
  LineChart,
  ListOrdered,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { BacktestDatePicker } from "@/components/backtests/backtest-date-picker";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Alert, AlertDescription } from "@/components/shadcn/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/shadcn/field";
import { Input } from "@/components/shadcn/input";
import { Separator } from "@/components/shadcn/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/shadcn/tabs";
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
      className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 [&>[data-slot=table-container]]:w-max [&>[data-slot=table-container]]:overflow-visible"
      role="region"
      tabIndex={0}
    >
      <Table className="min-w-[48rem]">
        <TableCaption className="sr-only">
          纸面账本事件和现金分录；时间均为 UTC。
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">序号</TableHead>
            <TableHead scope="col">账本事件</TableHead>
            <TableHead scope="col">有效时间</TableHead>
            <TableHead scope="col">现金分录</TableHead>
            <TableHead scope="col">记录时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger.entries.map((entry) => (
            <TableRow key={entry.cashEntryId ?? entry.eventId}>
              <TableCell className="font-mono tabular-nums">
                {entry.sequenceNo}
              </TableCell>
              <TableHead scope="row">
                {eventLabels[entry.eventType] ?? entry.eventType}
              </TableHead>
              <TableCell>{formatUtc(entry.effectiveAtMs)}</TableCell>
              <TableCell>
                {entry.bucket
                  ? `${bucketLabels[entry.bucket] ?? entry.bucket} · ${formatCashEntry(entry.amountMinor, entry.currencyCode, entry.currencyScale)}`
                  : formatCashEntry(
                      entry.amountMinor,
                      entry.currencyCode,
                      entry.currencyScale,
                    )}
              </TableCell>
              <TableCell>{formatUtc(entry.recordedAtMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
        <h1 className="sr-only">回测与纸面账户</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          回测只检验明确的历史假设；本地纸面账本与回测结果分开记录。本页不会连接券商或提交真实订单。
        </p>
      </header>

      <Tabs aria-label="回测与纸面账户内容" defaultValue="research">
        <TabsList>
          <TabsTrigger value="research">回测研究</TabsTrigger>
          <TabsTrigger value="account">纸面账户</TabsTrigger>
        </TabsList>
        <TabsContent className="flex flex-col gap-4" value="research">
          <Card aria-labelledby="parameters-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="parameters-heading">回测参数</h2>
              </CardTitle>
              <CardDescription>
                参数预览仅保存在当前地址；不会写入数据库或启动实验。
              </CardDescription>
              <CardAction>
                <Badge variant="outline">运行引擎未接入</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <form action="/backtests" method="get">
                <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field className="sm:min-w-40 sm:flex-1">
                    <FieldLabel htmlFor="market">市场</FieldLabel>
                    <Select
                      defaultValue={draft.market || undefined}
                      name="market"
                      required
                    >
                      <SelectTrigger className="w-full" id="market">
                        <SelectValue placeholder="选择市场" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="JP">日本</SelectItem>
                        <SelectItem value="US">美国</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="sm:min-w-40 sm:flex-1">
                    <FieldLabel htmlFor="instrument">证券标识</FieldLabel>
                    <Input
                      autoCapitalize="characters"
                      id="instrument"
                      maxLength={32}
                      name="instrument"
                      required
                      defaultValue={draft.instrument}
                    />
                  </Field>
                  <Field className="sm:min-w-40 sm:flex-1">
                    <FieldLabel htmlFor="interval">周期</FieldLabel>
                    <Select
                      defaultValue={draft.interval || undefined}
                      name="interval"
                      required
                    >
                      <SelectTrigger className="w-full" id="interval">
                        <SelectValue placeholder="选择周期" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="86400">日线</SelectItem>
                        <SelectItem value="3600">60 分钟</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="sm:min-w-40 sm:flex-1">
                    <FieldLabel htmlFor="from">开始日期</FieldLabel>
                    <BacktestDatePicker
                      id="from"
                      name="from"
                      placeholder="选择开始日期"
                      value={draft.from}
                    />
                  </Field>
                  <Field className="sm:min-w-40 sm:flex-1">
                    <FieldLabel htmlFor="to">结束日期</FieldLabel>
                    <BacktestDatePicker
                      id="to"
                      name="to"
                      placeholder="选择结束日期"
                      value={draft.to}
                    />
                  </Field>
                </FieldGroup>
                {draft.dateRangeInvalid && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      开始日期不能晚于结束日期。
                    </AlertDescription>
                  </Alert>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  日期按所选市场解释；当前没有已核验历史行情或回测引擎。输入内容不代表证券已确认、数据已覆盖或结果可复现。
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit">应用参数草稿</Button>
                  <Button disabled type="button" variant="outline">
                    开始回测
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    缺少回测引擎、历史数据和版本化成本模型。
                  </span>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card aria-labelledby="results-heading">
              <CardHeader>
                <CardTitle>
                  <h2 id="results-heading">实验结果</h2>
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">NOT_VERIFIED</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Empty>
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
              </CardContent>
            </Card>

            <Card aria-labelledby="cost-risk-heading">
              <CardHeader>
                <CardTitle>
                  <h2 id="cost-risk-heading">费用与风险边界</h2>
                </CardTitle>
                <CardAction>
                  <ShieldCheck
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">
                      佣金、税费、价差与滑点
                    </dt>
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
                <Separator />
                <CardDescription>
                  风险比例是固定系统边界，不可由页面修改。当前权益、成本或输入证据未核验时，不计算风险预算或模拟通过结论。
                </CardDescription>
              </CardContent>
            </Card>

            <Card aria-labelledby="equity-heading">
              <CardHeader>
                <CardTitle>
                  <h2 id="equity-heading">权益曲线</h2>
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">NOT_VERIFIED</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Empty>
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
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent className="flex flex-col gap-4" value="account">
          <Card aria-labelledby="account-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="account-heading">纸面账户与账本</h2>
              </CardTitle>
              <CardAction>
                <Badge
                  variant={
                    ledger.state === "INITIALIZED" ? "secondary" : "outline"
                  }
                >
                  {ledger.state === "INITIALIZED"
                    ? "已建立"
                    : ledger.state === "NOT_INITIALIZED"
                      ? "未建立"
                      : "NOT_VERIFIED"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {ledger.state === "NOT_INITIALIZED" ? (
                <Empty>
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
                <Alert>
                  <AlertDescription>
                    本机数据库无法读取。账本、余额和风险状态均为 NOT_VERIFIED。
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">基准币种</dt>
                      <dd className="mt-1">{ledger.baseCurrency}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">开户时间</dt>
                      <dd className="mt-1">
                        {formatUtc(ledger.initializedAtMs)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        当前权益 / 风险预算
                      </dt>
                      <dd className="mt-1">NOT_VERIFIED · 估值引擎未接入</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">账本现金流水</dt>
                      <dd className="mt-1">
                        {ledger.entries.length} 条事件记录
                      </dd>
                    </div>
                  </dl>
                  {ledger.entries.length > 0 ? (
                    <LedgerRows ledger={ledger} />
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>
                          <h3>暂无账本事件</h3>
                        </EmptyTitle>
                        <EmptyDescription>
                          <p>账户已建立，但没有账本事件记录。</p>
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card aria-labelledby="orders-heading">
            <CardHeader>
              <CardTitle>
                <h2 id="orders-heading">模拟订单状态</h2>
              </CardTitle>
              <CardAction>
                <Badge variant="outline">NOT_VERIFIED</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-3xl text-sm text-muted-foreground">
                  模拟订单存储、风险裁决、版本绑定批准和撮合运行时尚未接入。没有可核验订单状态；此页面不能直接写入订单或账本。
                </p>
                <Button className="shrink-0" disabled type="button">
                  <ListOrdered aria-hidden="true" />
                  创建模拟订单
                </Button>
              </div>
              <Empty>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
