"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/shadcn/field";
import { Input } from "@/components/shadcn/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/shadcn/collapsible";

type EodhdDailyStatus = Readonly<{
  configured: boolean;
  used: number;
  limit: number;
}>;

function responseError(payload: unknown, status: number) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload)
  ) {
    return "本机未能获取行情，请稍后重试。";
  }
  const error = payload.error;
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "本机未能获取行情，请稍后重试。";
  }
  switch (error.code) {
    case "MARKET_DATA_NOT_CONFIGURED":
      return "请在本机服务环境设置 EODHD_API_TOKEN 后重试。";
    case "MARKET_DATA_DAILY_LIMIT":
      return "本机应用的免费请求额度已用完，将在 UTC 午夜后重置。";
    case "MARKET_DATA_CREDENTIAL_REJECTED":
      return "EODHD 未接受该 API Key；请在本机检查环境变量。";
    case "MARKET_DATA_ACCESS_NOT_ENTITLED":
      return "当前 EODHD 凭据或计划无权访问该证券；本次请求已计入免费额度。";
    case "MARKET_DATA_SYMBOL_UNAVAILABLE":
      return "EODHD 未返回该证券的可用日线；代码可能不存在、历史超出免费范围或已变更。本次请求已计入免费额度。";
    case "MARKET_DATA_INVALID_RESPONSE":
      return "来源数据未通过日期、价格、OHLCV 或格式校验。";
    case "MARKET_DATA_UNAVAILABLE":
      return "EODHD 暂时不可用；已保存的本机行情仍保留。";
    case "VALIDATION_FAILED":
      return "请输入有效的美股证券代码，例如 AAPL。";
    default:
      return status === 413
        ? "请求内容超出大小限制。"
        : "本机未能获取行情，请稍后重试。";
  }
}

export function UsMarketData({ configured, used, limit }: EodhdDailyStatus) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: new FormData(form).get("symbol") }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(payload, response.status));
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null ||
        !("symbol" in payload.data) ||
        typeof payload.data.symbol !== "string" ||
        !("rowsReceived" in payload.data) ||
        typeof payload.data.rowsReceived !== "number" ||
        !("rowsAdded" in payload.data) ||
        typeof payload.data.rowsAdded !== "number" ||
        !("cacheHit" in payload.data) ||
        typeof payload.data.cacheHit !== "boolean"
      ) {
        setError(
          "本机行情接口返回了无法识别的结果。保存数据未被自动升级为策略结论。",
        );
        return;
      }

      const { symbol, rowsAdded, rowsReceived, cacheHit } = payload.data;
      toast.success(
        cacheHit
          ? `${symbol} 已使用本机缓存`
          : `${symbol} 已保存 ${rowsAdded} 条日线`,
        {
          description: `当前快照包含 ${rowsReceived} 条 EOD 历史记录；不是实时行情。`,
        },
      );
      form.reset();
      router.refresh();
    } catch {
      setError("无法连接本机行情接口，请确认应用仍在运行。旧数据没有删除。 ");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="us-market-data-heading">获取美股历史日线</h2>
        </CardTitle>
        <CardDescription>
          EODHD Free · 单证券 · 最近一年 · 每次请求一个证券
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {configured && (
          <p className="text-sm text-muted-foreground">
            今日请求 {used}/{limit} 次 · API Key 只从本机服务环境读取。
          </p>
        )}
        {!configured && (
          <Alert>
            <AlertDescription>
              未配置 EODHD Free 凭据。设置本机服务环境变量 EODHD_API_TOKEN
              后，可按代码获取近一年日线。
            </AlertDescription>
          </Alert>
        )}
        {configured && (
          <form
            action="/api/v1/market-data/us"
            aria-labelledby="us-market-data-heading"
            method="post"
            onSubmit={submit}
            className="flex flex-col gap-4"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="eodhd-us-symbol">美股代码</FieldLabel>
                <Input
                  autoCapitalize="characters"
                  autoComplete="off"
                  disabled={pending}
                  id="eodhd-us-symbol"
                  maxLength={32}
                  name="symbol"
                  pattern="[A-Za-z0-9][A-Za-z0-9.\-]{0,31}"
                  placeholder="AAPL"
                  required
                  spellCheck={false}
                />
                <FieldDescription>
                  例如 AAPL；确认代码后再提交，以免浪费免费请求额度。
                </FieldDescription>
              </Field>
            </FieldGroup>
            <Button className="self-start" disabled={pending} type="submit">
              {pending ? "获取中…" : "获取近一年日线"}
            </Button>
          </form>
        )}
        {error && (
          <Alert aria-live="polite" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button className="self-start" size="sm" variant="outline" />
            }
          >
            来源限制
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                免费额度每天 {limit} 次，按 UTC
                午夜重置；错误代码也消耗额度，本机不统计其他程序共用此密钥的请求。
              </li>
              <li>
                仅最近一年 EOD 日线；聚合数据不保证准确性，原始
                OHLC、拆股调整成交量，未纳入公司行动。
              </li>
              <li>
                密钥不会发送到浏览器或写入数据库；这些行情不用于长期策略验证或回测。
              </li>
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
