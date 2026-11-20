import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadLedger } = vi.hoisted(() => ({ loadLedger: vi.fn() }));

vi.mock("@/features/paper-account/paper-account-center", () => ({
  loadPaperAccountLedger: loadLedger,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import BacktestsPage from "@/app/backtests/page";

describe("BacktestsPage", () => {
  beforeEach(() => {
    loadLedger.mockResolvedValue({ state: "NOT_INITIALIZED" });
  });

  it("separates paper-account content from the default research tab", async () => {
    const html = renderToStaticMarkup(
      await BacktestsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("回测研究");
    expect(html).toContain("纸面账户");
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).not.toContain("纸面账本未建立");
    expect(html).toContain("NOT_VERIFIED");
    expect(html).toContain('method="get"');
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>[\s\S]*?开始回测/);
    expect(html).toContain("不显示胜率、收益或策略评分");
    expect(html).not.toContain("18/25");
  });

  it("keeps valid parameters in an idempotent URL draft without running them", async () => {
    const html = renderToStaticMarkup(
      await BacktestsPage({
        searchParams: Promise.resolve({
          market: "JP",
          instrument: " 7203 ",
          interval: "86400",
          from: "2020-01-01",
          to: "2025-12-31",
        }),
      }),
    );

    expect(html).toMatch(/id="market"[^>]*data-slot="select-trigger"/);
    expect(html).toMatch(/id="interval"[^>]*data-slot="select-trigger"/);
    expect(html).toContain(">JP</span>");
    expect(html).toContain(">86400</span>");
    expect(html).toContain('value="7203"');
    expect(html).toContain('value="2020-01-01"');
    expect(html).toContain('value="2025-12-31"');
    expect(html).toContain("不会写入数据库或启动实验");
  });

  it("opens the account tab and exposes the fixed one-time initializer", async () => {
    const html = renderToStaticMarkup(
      await BacktestsPage({
        searchParams: Promise.resolve({ tab: "account" }),
      }),
    );

    expect(html).toContain("纸面账本未建立");
    expect(html).toContain("建立纸面账户");
    expect(html).toContain("1,000,000 日元初始现金");
    expect(html).toMatch(/aria-selected="true"[^>]*>纸面账户<\/button>/);
  });

  it("accepts only safe positive ledger page numbers", async () => {
    await BacktestsPage({
      searchParams: Promise.resolve({ page: "2", tab: "account" }),
    });
    expect(loadLedger).toHaveBeenCalledWith(2);

    loadLedger.mockClear();
    await BacktestsPage({
      searchParams: Promise.resolve({ page: "9007199254740992" }),
    });
    expect(loadLedger).toHaveBeenCalledWith(1);
  });

  it("renders previous and next account-ledger page navigation", async () => {
    loadLedger.mockResolvedValue({
      state: "INITIALIZED",
      audit: {
        ledger: { status: "NOT_VERIFIED", issueCodes: ["TEST_FIXTURE"] },
        trades: [],
        equity: {
          status: "NOT_VERIFIED",
          issueCodes: ["EQUITY_HISTORY_NOT_ESTABLISHED"],
          curve: [],
          maximumDrawdown: null,
        },
      },
      baseCurrency: "JPY",
      initializedAtMs: "1794816000000",
      page: 2,
      totalEventCount: 101,
      totalPages: 2,
      eventCount: 1,
      hasPrevious: true,
      hasNext: false,
      entries: [
        {
          eventId: "event-101",
          sequenceNo: "101",
          eventType: "REVERSAL",
          effectiveAtMs: "1794816060000",
          recordedAtMs: "1794816060000",
          cashEntryId: null,
          bucket: null,
          currencyCode: null,
          currencyScale: null,
          amountMinor: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      await BacktestsPage({
        searchParams: Promise.resolve({ tab: "account", page: "2" }),
      }),
    );

    expect(html).toContain("第 2 / 2 页 · 本页 1 个事件");
    expect(html).toContain('href="/backtests?tab=account&amp;page=1"');
    expect(html).toContain("上一页");
    expect(html).not.toContain("下一页");
  });

  it("shows fixed opening cash and its initial risk cap from the verified ledger", async () => {
    loadLedger.mockResolvedValue({
      state: "INITIALIZED",
      audit: {
        ledger: { status: "VERIFIED", issueCodes: [] },
        trades: [],
        equity: {
          status: "NOT_VERIFIED",
          issueCodes: ["EQUITY_HISTORY_NOT_ESTABLISHED"],
          curve: [],
          maximumDrawdown: null,
        },
      },
      baseCurrency: "JPY",
      initializedAtMs: "1794816000000",
      page: 1,
      totalEventCount: 1,
      totalPages: 1,
      eventCount: 1,
      hasPrevious: false,
      hasNext: false,
      entries: [
        {
          eventId: "event-1",
          sequenceNo: "1",
          eventType: "ACCOUNT_OPENED",
          effectiveAtMs: "1794816000000",
          recordedAtMs: "1794816000000",
          cashEntryId: "cash-1",
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: "1000000",
        },
      ],
    });

    const html = renderToStaticMarkup(
      await BacktestsPage({
        searchParams: Promise.resolve({ tab: "account" }),
      }),
    );

    expect(html).toContain("JPY 1,000,000");
    expect(html).toContain("JPY 20,000");
    expect(html).toContain("开户时单笔风险上限（2%）");
    expect(html).toContain("估值引擎未接入");
    expect(html).not.toContain("确认开户");
  });

  it("rejects invalid dates and reports reversed valid dates", async () => {
    const html = renderToStaticMarkup(
      await BacktestsPage({
        searchParams: Promise.resolve({
          market: "UNKNOWN",
          instrument: "x".repeat(40),
          interval: "1",
          from: "2025-01-01",
          to: "2020-01-01",
        }),
      }),
    );

    expect(html).toContain("开始日期不能晚于结束日期");
    expect(html).toContain(`value="${"x".repeat(32)}"`);
    expect(html).not.toContain(">UNKNOWN</span>");
    expect(html).toContain("选择市场");
    expect(html).toContain("选择周期");
  });

  it("does not mix persisted account events into the default research tab", async () => {
    loadLedger.mockResolvedValue({
      state: "INITIALIZED",
      audit: {
        ledger: { status: "VERIFIED", issueCodes: [] },
        trades: [],
        equity: {
          status: "NOT_VERIFIED",
          issueCodes: ["EQUITY_HISTORY_NOT_ESTABLISHED"],
          curve: [],
          maximumDrawdown: null,
        },
      },
      baseCurrency: "JPY",
      initializedAtMs: "1794816000000",
      page: 1,
      totalEventCount: 1,
      totalPages: 1,
      eventCount: 1,
      hasPrevious: false,
      hasNext: false,
      entries: [
        {
          eventId: "event-1",
          sequenceNo: "1",
          eventType: "ACCOUNT_OPENED",
          effectiveAtMs: "1794816000000",
          recordedAtMs: "1794816000000",
          cashEntryId: "cash-1",
          bucket: "SETTLED",
          currencyCode: "JPY",
          currencyScale: 0,
          amountMinor: "1000000",
        },
      ],
    });

    const html = renderToStaticMarkup(
      await BacktestsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("纸面账户");
    expect(html).not.toContain("账户开户");
    expect(html).not.toContain("JPY 1,000,000");
    expect(html).not.toContain('aria-labelledby="account-heading"');
  });

  it("renders only an audited equity curve and its maximum drawdown", async () => {
    loadLedger.mockResolvedValue({
      state: "INITIALIZED",
      audit: {
        ledger: { status: "VERIFIED", issueCodes: [] },
        trades: [],
        equity: {
          status: "VERIFIED",
          issueCodes: [],
          curve: [
            {
              asOfMs: "1794816000000",
              equityMinor: "1000000",
              source: "ACCOUNT_OPENED",
            },
            {
              asOfMs: "1794816060000",
              equityMinor: "800000",
              source: "VALUATION",
            },
          ],
          maximumDrawdown: {
            basisPoints: "2000",
            peakAtMs: "1794816000000",
            peakMinor: "1000000",
            troughAtMs: "1794816060000",
            troughMinor: "800000",
          },
        },
      },
      baseCurrency: "JPY",
      initializedAtMs: "1794816000000",
      page: 1,
      totalEventCount: 0,
      totalPages: 1,
      eventCount: 0,
      hasPrevious: false,
      hasNext: false,
      entries: [],
    });

    const html = renderToStaticMarkup(
      await BacktestsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("20.00%");
    expect(html).toContain("JPY 800,000");
    expect(html).toContain("可核验权益点");
  });
});
