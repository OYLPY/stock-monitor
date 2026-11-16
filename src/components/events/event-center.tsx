import { CircleHelp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MARKET_TIME_ZONES } from "@/domain/primitives";
import type { getMarketEvent } from "@/features/evidence/repository";

type MarketEvent = NonNullable<ReturnType<typeof getMarketEvent>>;
type EventFilters = {
  market: "" | "JP" | "US";
  verification: string;
};

const verificationLabels: Record<string, string> = {
  VERIFIED: "已验证",
  PARTIAL: "部分核验",
  NOT_VERIFIED: "未核验",
  DEMO_ONLY: "仅演示",
};

const dataClassLabels: Record<string, string> = {
  REAL: "真实来源",
  DELAYED: "延迟数据",
  HISTORICAL: "历史数据",
  FIXTURE: "演示数据",
  NOT_VERIFIED: "未核验",
};

const evidenceRelationLabels: Record<string, string> = {
  SUPPORTS: "支持",
  CONTRADICTS: "反驳",
  CONTEXT: "背景",
};

const sourceRoleLabels: Record<string, string> = {
  REGULATORY_PRIMARY: "监管原始来源",
  EXCHANGE_PRIMARY: "交易所原始来源",
  ISSUER_PRIMARY: "发行人原始来源",
  AUTHORIZED_VENDOR: "获授权数据商",
  SECONDARY: "二手来源",
  FIXTURE: "测试/演示来源",
  UNKNOWN: "未知来源角色",
};

const licenseStatusLabels: Record<string, string> = {
  VERIFIED: "许可已核验",
  NOT_VERIFIED: "许可未核验",
  UNKNOWN: "许可未知",
};

const marketLabels: Record<string, string> = {
  JP: "日本市场",
  US: "美国市场",
};

function validTimeZone(value: string | null) {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function formatTime(value: bigint | null, timeZone: string) {
  if (value === null) return "未提供";
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "时间无效";
  return `${new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date)} ${timeZone}`;
}

function EventCard({ event }: { event: MarketEvent }) {
  const latest = event.revisions.at(-1);
  if (!latest) {
    return (
      <li>
        <article className="rounded-xl border bg-card p-4 sm:p-5">
          <p>事件没有可展示的修订记录。</p>
        </article>
      </li>
    );
  }

  const marketTimeZone =
    latest.marketCode === "JP"
      ? MARKET_TIME_ZONES.JP
      : latest.marketCode === "US"
        ? MARKET_TIME_ZONES.US
        : "UTC";
  const marketLabel = latest.marketCode
    ? (marketLabels[latest.marketCode] ?? "未知市场")
    : "未指定市场";

  return (
    <li>
      <article className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="break-words text-base font-semibold">
              {latest.summary}
            </h3>
            <p className="text-sm text-muted-foreground">{marketLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {verificationLabels[latest.verificationLevel] ?? "未知核验等级"}
            </Badge>
            <Badge variant="secondary">
              {dataClassLabels[latest.dataClass] ?? "未知数据状态"}
            </Badge>
          </div>
        </header>

        <dl className="grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground">事件类别代码</dt>
            <dd className="break-all">
              <code>{latest.category}</code>
            </dd>
          </div>
          {latest.instrumentKey && (
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-muted-foreground">证券标识</dt>
              <dd className="break-all">
                <code>{latest.instrumentKey}</code>
              </dd>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground">首次发现</dt>
            <dd className="break-words">
              {formatTime(latest.firstSeenAtMs, marketTimeZone)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground">事件发生时间</dt>
            <dd className="break-words">
              {formatTime(latest.occurredAtMs, marketTimeZone)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground">来源发布时间</dt>
            <dd className="break-words">
              {formatTime(latest.publishedAtMs, marketTimeZone)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground">重要性等级</dt>
            <dd>尚未分级</dd>
          </div>
        </dl>

        <div className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">重要性依据：</span>
            {latest.importanceReason}
          </p>
          <p>
            <span className="text-muted-foreground">风险评估：</span>
            尚无已保存的风险裁决记录。
          </p>
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">通知状态：</span>
            扫描水位与通知决策尚未接入，当前无法判断是否符合新发现和高重要性条件。
          </p>
        </div>

        <details className="border-t pt-3">
          <summary className="min-h-12 cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2">
            修订与来源证据（{event.revisions.length} 条修订）
          </summary>
          <ol className="mt-3 flex flex-col gap-4">
            {event.revisions.map((revision) => (
              <li className="min-w-0 border-l-2 pl-4" key={revision.id}>
                <h4 className="text-sm font-semibold">
                  修订 {revision.revisionNo}
                </h4>
                <p className="mt-1 break-words text-sm">{revision.summary}</p>
                <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground">记录时间</dt>
                    <dd className="break-words">
                      {formatTime(revision.recordedAtMs, marketTimeZone)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground">核验说明</dt>
                    <dd className="break-words">
                      {revision.verificationReason ?? "未提供"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground">
                      数据状态 / 核验等级
                    </dt>
                    <dd>
                      {dataClassLabels[revision.dataClass] ?? "未知数据状态"} /{" "}
                      {verificationLabels[revision.verificationLevel] ??
                        "未知核验等级"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <dt className="text-muted-foreground">指纹规则 / 摘要</dt>
                    <dd className="break-all">
                      {revision.fingerprintAlgorithmVersion} /{" "}
                      {revision.fingerprintSha256}
                    </dd>
                  </div>
                </dl>

                {revision.evidence.length ? (
                  <ul className="mt-3 flex min-w-0 flex-col gap-3">
                    {revision.evidence.map((evidence) => {
                      const sourceUrl =
                        evidence.canonicalUrl ?? evidence.sourceReferenceUrl;
                      const sourceZone = validTimeZone(evidence.sourceTimeZone);
                      return (
                        <li
                          className="min-w-0 rounded-lg bg-muted/40 p-3 text-sm"
                          key={evidence.sourceRecordId}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {evidence.publisher}
                            </span>
                            <Badge variant="outline">
                              {evidenceRelationLabels[evidence.relation] ??
                                "未知证据关系"}
                            </Badge>
                            <Badge variant="secondary">
                              {dataClassLabels[evidence.dataClass] ??
                                "未知数据状态"}
                            </Badge>
                            <Badge variant="outline">
                              {sourceRoleLabels[evidence.authorityRole] ??
                                "未知来源角色"}
                            </Badge>
                            <Badge variant="outline">
                              {licenseStatusLabels[
                                evidence.sourceLicenseStatus
                              ] ?? "许可未知"}
                            </Badge>
                          </div>
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            来源标识 <code>{evidence.sourceKey}</code> ·
                            记录标识 <code>{evidence.recordKey}</code> · 版本{" "}
                            {evidence.recordVersion}
                          </p>
                          <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-1">
                              <dt className="text-muted-foreground">
                                来源发生时间
                              </dt>
                              <dd className="break-words">
                                {formatTime(evidence.occurredAtMs, sourceZone)}
                                {` · 记录时区 ${evidence.sourceTimeZone ?? "未提供"}`}
                                {evidence.rawTimeText
                                  ? ` · ${evidence.rawTimeText}`
                                  : ""}
                              </dd>
                            </div>
                            <div className="flex min-w-0 flex-col gap-1">
                              <dt className="text-muted-foreground">
                                来源发布时间
                              </dt>
                              <dd className="break-words">
                                {formatTime(evidence.publishedAtMs, sourceZone)}
                              </dd>
                            </div>
                            <div className="flex min-w-0 flex-col gap-1">
                              <dt className="text-muted-foreground">
                                本机采集时间
                              </dt>
                              <dd className="break-words">
                                {formatTime(evidence.collectedAtMs, "UTC")}
                              </dd>
                            </div>
                            <div className="flex min-w-0 flex-col gap-1">
                              <dt className="text-muted-foreground">
                                来源内容 SHA-256
                              </dt>
                              <dd className="break-all">
                                {evidence.contentHashSha256}
                              </dd>
                            </div>
                          </dl>
                          <p className="mt-3">
                            {sourceUrl ? (
                              <a
                                className="underline underline-offset-4"
                                href={sourceUrl}
                                rel="noreferrer noopener"
                                target="_blank"
                              >
                                打开来源记录
                              </a>
                            ) : (
                              <span className="text-muted-foreground">
                                未提供可打开的来源链接
                              </span>
                            )}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    此修订没有关联来源证据，不能显示为已验证。
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      </article>
    </li>
  );
}

export function EventCenter({
  events,
  filters,
  totalEvents,
}: {
  events: MarketEvent[];
  filters: EventFilters;
  totalEvents: number;
}) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">研究监测</p>
        <h1
          className="scroll-mt-6 text-2xl font-semibold tracking-tight sm:text-3xl"
          id="main-content"
          tabIndex={-1}
        >
          异常与事件
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          仅展示本机事件库中已保存的修订与来源证据。P07
          来源接入尚未完成；空列表不表示市场没有事件。
        </p>
      </header>

      <section
        aria-labelledby="event-filters-heading"
        className="flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold" id="event-filters-heading">
          筛选事件
        </h2>
        <search>
          <form
            action="/events"
            className="rounded-xl border bg-card p-4"
            method="get"
          >
            <fieldset className="flex flex-col gap-4 border-0 p-0 sm:flex-row sm:flex-wrap sm:items-end">
              <legend className="sr-only">事件筛选条件</legend>
              <div className="flex min-w-0 flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="market-filter">
                  市场
                </label>
                <select
                  className="min-h-12 min-w-40 rounded-md border bg-background px-3 text-sm"
                  defaultValue={filters.market}
                  id="market-filter"
                  name="market"
                >
                  <option value="">全部市场</option>
                  <option value="US">美国市场</option>
                  <option value="JP">日本市场</option>
                </select>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="verification-filter"
                >
                  核验等级
                </label>
                <select
                  className="min-h-12 min-w-40 rounded-md border bg-background px-3 text-sm"
                  defaultValue={filters.verification}
                  id="verification-filter"
                  name="verification"
                >
                  <option value="">全部等级</option>
                  {Object.entries(verificationLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <Button className="min-h-12" type="submit">
                应用筛选
              </Button>
            </fieldset>
          </form>
        </search>
      </section>

      <section
        aria-labelledby="event-list-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold" id="event-list-heading">
            事件记录
          </h2>
          <p className="text-sm text-muted-foreground">
            {filters.market || filters.verification
              ? `显示 ${events.length} / ${totalEvents} 条`
              : `${totalEvents} 条本机记录`}
          </p>
        </div>

        {totalEvents === 0 ? (
          <Empty className="min-h-56 border bg-card px-4 py-10 sm:px-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleHelp aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>暂无已保存的事件</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>
                  当前没有可展示的本机事件记录；数据源未接入或扫描尚未运行时，不能据此确认没有市场事件。
                </p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : events.length === 0 ? (
          <Empty className="min-h-40 border bg-card px-4 py-8 sm:px-8">
            <EmptyHeader>
              <EmptyTitle>
                <h3>没有符合条件的事件</h3>
              </EmptyTitle>
              <EmptyDescription>
                <p>更改市场或核验等级后重试。</p>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
