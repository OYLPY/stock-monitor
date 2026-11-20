import { createElement } from "react";
import type { ReactNode } from "react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  openDatabase: vi.fn(async () => ({ client: { close: vi.fn() } })),
  listReports: vi.fn((): unknown[] => []),
  listTaskRuns: vi.fn((): unknown[] => []),
  readTaskRun: vi.fn((): unknown => null),
}));

vi.mock("@/db", () => ({
  getLocalDatabasePath: () => "test-database.sqlite",
  openDatabase: pageMocks.openDatabase,
}));
vi.mock("@/features/reports/archive", () => ({
  listArchivedResearchReports: pageMocks.listReports,
}));
vi.mock("@/features/task-queue/queue", () => ({
  listTaskRuns: pageMocks.listTaskRuns,
  readTaskRun: pageMocks.readTaskRun,
}));
vi.mock("@/components/tasks/cancel-task-button", () => ({
  CancelTaskButton: ({ label }: { label: string }) =>
    createElement("button", { type: "button" }, `取消${label}`),
}));

vi.mock("@/components/shadcn/collapsible", async () => {
  const React = await import("react");
  const Content = ({ children }: { children: ReactNode }) =>
    React.createElement("div", null, children);
  const Trigger = ({ children }: { children: ReactNode }) =>
    React.createElement("button", { type: "button" }, children);

  return {
    Collapsible: Content,
    CollapsibleContent: Content,
    CollapsibleTrigger: Trigger,
  };
});

import ReportsPage from "@/app/reports/page";
import { ReportCenter } from "@/components/reports/report-center";

const reportFixture = {
  id: "report-001",
  type: "MORNING" as const,
  title: "日本市场晨报",
  generatedAtMs: Date.UTC(2026, 10, 16, 0),
  asOfMs: Date.UTC(2026, 10, 15, 6),
  timeZone: "Asia/Tokyo",
  executionStatus: "DONE" as const,
  verificationLevel: "PARTIAL" as const,
  dataClass: "HISTORICAL" as const,
  resultCode: "PARTIAL_COVERAGE",
  marketSummary: [
    { text: "日本市场摘要一", evidenceIds: ["evidence-1"] },
    { text: "日本市场摘要二", evidenceIds: [] },
    { text: "日本市场摘要三", evidenceIds: [] },
    { text: "日本市场摘要四", evidenceIds: [] },
    { text: "日本市场摘要五", evidenceIds: [] },
  ],
  marketCalendars: [
    {
      exchange: "NYSE" as const,
      marketCode: "US" as const,
      date: "2026-11-15",
      currentStatus: "CLOSED" as const,
      currentReason: "WEEKEND",
      latestCompletedDate: "2026-11-13",
      timeZone: "America/New_York",
      calendarVersion: "nyse-cash-2026-2028-as-of-2026-11-16",
      checkedAt: "2026-11-16T10:07:15.000Z",
      sourceUrls: ["https://www.nyse.com/trade/hours-calendars"],
    },
    {
      exchange: "NASDAQ" as const,
      marketCode: "US" as const,
      date: "2026-11-15",
      currentStatus: "CLOSED" as const,
      currentReason: "WEEKEND",
      latestCompletedDate: "2026-11-13",
      timeZone: "America/New_York",
      calendarVersion: "nasdaq-us-cash-2026-as-of-2026-11-16",
      checkedAt: "2026-11-16T10:07:15.000Z",
      sourceUrls: [
        "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule",
      ],
    },
    {
      exchange: "TSE" as const,
      marketCode: "JP" as const,
      date: "2026-11-15",
      currentStatus: "CLOSED" as const,
      currentReason: "WEEKEND",
      latestCompletedDate: "2026-11-13",
      timeZone: "Asia/Tokyo",
      calendarVersion: "jpx-cash-equities-2026-2027-as-of-2026-11-16",
      checkedAt: "2026-11-16T10:07:15.000Z",
      sourceUrls: [
        "https://www.jpx.co.jp/english/corporate/about-jpx/calendar/index.html",
      ],
    },
  ],
  eventTimeline: {
    status: "NOT_VERIFIED" as const,
    asOfMs: Date.UTC(2026, 10, 16),
    recentEvents: [],
    upcoming24hEvents: [],
    note: "本机事件记录不构成完整日历。",
  },
  facts: [{ text: "来源支持的事实", evidenceIds: ["evidence-1"] }],
  inferences: [{ text: "基于事实的推论", evidenceIds: ["evidence-1"] }],
  hypotheses: [{ text: "待验证的研究假设", evidenceIds: ["evidence-1"] }],
  candidates: [
    {
      id: "candidate-1",
      logic: "历史区间突破研究假设",
      trigger: "若后续有效数据满足条件",
      invalidation: "若价格跌破研究失效条件",
      opposingCase: "区间突破可能是假信号",
      evidenceIds: ["evidence-1"],
      unresolvedQuestions: ["需要样本外验证"],
      validationDimensions: {
        outOfSampleStability: "NOT_VERIFIED" as const,
        afterCostReturn: "NOT_VERIFIED" as const,
        maxDrawdown: "NOT_VERIFIED" as const,
        executionFeasibility: "NOT_VERIFIED" as const,
        crossEnvironmentRobustness: "NOT_VERIFIED" as const,
      },
    },
  ],
  roleAudit: {
    coordinator: {
      status: "DONE" as const,
      summary: "明确研究范围",
      evidenceIds: [],
    },
    intelligence: {
      status: "DONE" as const,
      summary: "整理来源事实",
      evidenceIds: ["evidence-1"],
    },
    marketStructure: {
      status: "DONE" as const,
      summary: "指出数据缺口",
      evidenceIds: [],
    },
    strategyResearch: {
      status: "DONE" as const,
      summary: "提出待验证假设",
      evidenceIds: ["evidence-1"],
    },
    riskOfficer: {
      status: "DONE" as const,
      summary: "提示风险缺口",
      evidenceIds: [],
    },
    paperPlanner: {
      status: "SKIPPED" as const,
      summary: "数据不足，未生成计划",
      evidenceIds: [],
    },
  },
  riskVerdict: {
    status: "REJECTED" as const,
    reasons: ["缺少可核验的当前权益输入"],
  },
  riskOfficerReview: {
    opinion: "VETO" as const,
    summary: "关键输入未核验",
    evidenceIds: [],
  },
  ledgerState: "UNAVAILABLE" as const,
  ledgerSummary: null,
  sourceCoverage: [
    {
      id: "source-1",
      name: "测试来源",
      url: "https://example.test/source",
      status: "AVAILABLE" as const,
      dataClass: "HISTORICAL" as const,
      marketAtMs: Date.UTC(2026, 10, 15, 6),
      marketTimeZone: "Asia/Tokyo",
      collectedAtMs: Date.UTC(2026, 10, 15, 6, 5),
      collectedTimeZone: "UTC",
      currency: "JPY",
      delayStatement: null,
      limitation: "仅为离线组件测试内容",
      evidenceIds: ["evidence-1"],
    },
  ],
  limitations: ["没有当前市场数据"],
  finalDecision: "等待数据接入后重新核验。",
};

function renderReports(
  reports: ComponentProps<typeof ReportCenter>["reports"],
  filters: ComponentProps<typeof ReportCenter>["filters"] = {
    query: "",
    type: "",
  },
) {
  return renderToStaticMarkup(
    createElement(ReportCenter, {
      enqueueError: false,
      filters,
      reports,
      tasks: [],
      taskNotice: null,
    }),
  );
}

describe("reports page", () => {
  it("renders a truthful empty state without fabricated reports or scores", async () => {
    pageMocks.listReports.mockReturnValue([]);
    const page = await ReportsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("暂无报告");
    expect(html).toContain("加入队列");
    expect(html).toContain("晨报");
    expect(html).toContain("结论只依据本机已保存证据");
    expect(html).toContain('action="/api/v1/reports" method="post"');
    expect(html).not.toContain("胜率");
    expect(html).not.toContain("Sharpe");
    expect(html).not.toContain("收益率");
  });

  it("loads persisted task status for the redirected report page", async () => {
    pageMocks.readTaskRun.mockReturnValue({
      id: "0c72b1db-1577-4828-9e25-82af2eadd323",
      executionStatus: "PENDING",
      resultCode: null,
    });
    pageMocks.listTaskRuns.mockReturnValue([
      {
        id: "0c72b1db-1577-4828-9e25-82af2eadd323",
        kind: "REPORT",
        label: "晨报",
        executionStatus: "PENDING",
        attemptCount: 0,
        cancellationRequestedAtMs: null,
        resultCode: null,
        errorCode: null,
        createdAtMs: Date.UTC(2026, 10, 18, 22),
        startedAtMs: null,
        finishedAtMs: null,
      },
    ]);
    const page = await ReportsPage({
      searchParams: Promise.resolve({
        task: "0c72b1db-1577-4828-9e25-82af2eadd323",
      }),
    });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("报告任务队列");
    expect(html).toContain("排队中");
  });

  it("shows persisted report tasks after loading the page without a task query", async () => {
    pageMocks.listTaskRuns.mockReturnValue([
      {
        id: "0c72b1db-1577-4828-9e25-82af2eadd323",
        kind: "REPORT",
        label: "晨报",
        executionStatus: "PENDING",
        attemptCount: 0,
        cancellationRequestedAtMs: null,
        resultCode: null,
        errorCode: null,
        createdAtMs: Date.UTC(2026, 10, 18, 22),
        startedAtMs: null,
        finishedAtMs: null,
      },
    ]);
    const page = await ReportsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("任务队列（1 项活动）");
    expect(html).not.toContain("0c72b1db");
  });

  it("shows distinct evidence, inference, hypothesis, risk, and six-role audit", () => {
    const html = renderReports([reportFixture]);

    expect(html).toContain("来源支持的事实");
    expect(html).toContain("交易日历与已保存事件");
    expect(html).toContain("最近已完成交易日");
    expect(html).toContain("本机事件记录不构成完整日历。");
    expect(html).toContain("基于事实的推论");
    expect(html).toContain("待验证的研究假设");
    expect(html).toContain("拒绝");
    expect(html).toContain("缺少可核验的当前权益输入");
    expect(html).toContain("未提出模型否决也不代表风险通过");
    expect(html).toContain("统筹 Coordinator");
    expect(html).toContain("情报侦察 Intelligence");
    expect(html).toContain("市场结构 Market Structure");
    expect(html).toContain("策略研发 Strategy Research");
    expect(html).toContain("独立风控 Risk Officer");
    expect(html).toContain("模拟员 Paper Planner");
    expect(html).toContain("evidence-1");
    expect(html).not.toContain("胜率");
    expect(html).not.toContain("收益率");
  });

  it("keeps external failure and missing risk verdict unresolved", () => {
    const blockedReport = {
      ...reportFixture,
      executionStatus: "BLOCKED_EXTERNAL" as const,
      candidates: [],
      riskVerdict: null,
      riskOfficerReview: null,
      finalDecision: null,
    };
    const html = renderReports([blockedReport]);

    expect(html).toContain("外部阻断");
    expect(html).not.toContain("BLOCKED_EXTERNAL");
    expect(html).toContain("未记录确定性裁决；裁决缺失不等于通过。");
    expect(html).not.toContain("APPROVED_FOR_PAPER_REVIEW");
  });

  it("filters by report type and search text and orders newest first", () => {
    const otherReport = {
      ...reportFixture,
      id: "report-002",
      type: "DAILY_AUDIT" as const,
      title: "日度审计",
      generatedAtMs: Date.UTC(2026, 10, 17),
    };
    const html = renderReports([reportFixture, otherReport], {
      query: "日本市场",
      type: "MORNING",
    });
    const allReportsHtml = renderReports([reportFixture, otherReport]);
    const reportTitles = Array.from(
      allReportsHtml.matchAll(/<h3[^>]*>(.*?)<\/h3>/g),
      ([, title]) => title,
    );

    expect(html).toContain("日本市场晨报");
    expect(html).toContain("五维验证状态");
    expect(html).toContain("跨环境稳健性");
    expect(html).toContain("未验证");
    expect(html).not.toContain("NOT_VERIFIED");
    expect(html).not.toMatch(/<h3[^>]*>日度审计<\/h3>/);
    expect(html).toContain("1 / 2 份");
    expect(reportTitles.slice(0, 2)).toEqual(["日度审计", "日本市场晨报"]);
  });

  it("downgrades Fixture-derived reports and rejects malformed candidate sets", () => {
    const candidates = [1, 2, 3, 4].map((index) => ({
      ...reportFixture.candidates[0],
      id: `candidate-${index}`,
      logic: `候选 ${index}`,
    }));
    const fixtureReport = {
      ...reportFixture,
      verificationLevel: "VERIFIED" as const,
      sourceCoverage: [
        { ...reportFixture.sourceCoverage[0], dataClass: "FIXTURE" as const },
      ],
      candidates,
    };
    const html = renderReports([fixtureReport]);

    expect(html).toContain("仅演示");
    expect(html).toContain("已隔离为仅演示");
    expect(html).toContain("超过 3 个上限");
    expect(html).toContain("策略候选（4 / 3）");
    expect(html).not.toContain("候选 1");
  });

  it("shows only evidence-linked events under a research inference", () => {
    const linkedReport = {
      ...reportFixture,
      inferences: [
        {
          text: "两项官方事件可能共同影响市场预期。",
          evidenceIds: ["event-source-a", "event-source-b"],
        },
      ],
      eventTimeline: {
        ...reportFixture.eventTimeline,
        recentEvents: [
          {
            category: "MACRO",
            summary: "央行维持政策利率。",
            marketCode: "JP" as const,
            occurredAtMs: Date.UTC(2026, 10, 15),
            dataClass: "HISTORICAL" as const,
            verificationLevel: "PARTIAL" as const,
            evidenceIds: ["event-source-a"],
          },
          {
            category: "MACRO",
            summary: "就业数据超预期。",
            marketCode: "US" as const,
            occurredAtMs: Date.UTC(2026, 10, 16),
            dataClass: "HISTORICAL" as const,
            verificationLevel: "PARTIAL" as const,
            evidenceIds: ["event-source-b"],
          },
        ],
      },
    };
    const html = renderReports([linkedReport]);

    expect(html).toContain("两项官方事件可能共同影响市场预期。");
    expect(html).toContain("引用事件（按证据编号关联，不代表因果）");
    expect(html).toContain("央行维持政策利率。");
    expect(html).toContain("就业数据超预期。");
  });

  it("does not create a link from an unsafe source URL", () => {
    const unsafeReport = {
      ...reportFixture,
      sourceCoverage: [
        { ...reportFixture.sourceCoverage[0], url: "javascript:alert(1)" },
      ],
    };
    const html = renderReports([unsafeReport]);

    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("没有可打开的 HTTPS 来源链接");
  });
});
