import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadLedger } = vi.hoisted(() => ({ loadLedger: vi.fn() }));

vi.mock("@/features/paper-account/paper-account-center", () => ({
  loadPaperAccountLedger: loadLedger,
}));

import BacktestsPage from "@/app/backtests/page";

describe("BacktestsPage", () => {
  beforeEach(() => {
    loadLedger.mockResolvedValue({ state: "NOT_INITIALIZED" });
  });

  it("shows the uninitialized ledger and blocks unsupported execution", async () => {
    const html = renderToStaticMarkup(
      await BacktestsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("纸面账本未建立");
    expect(html).toContain("NOT_VERIFIED");
    expect(html).toContain('method="get"');
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>[\s\S]*?开始回测/);
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")[^>]*>[\s\S]*?创建模拟订单/,
    );
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

  it("renders only actual persisted account events when the account exists", async () => {
    loadLedger.mockResolvedValue({
      state: "INITIALIZED",
      baseCurrency: "JPY",
      initializedAtMs: "1794816000000",
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

    expect(html).toContain("已建立");
    expect(html).toContain("账户开户");
    expect(html).toContain("JPY 1,000,000");
    expect(html).toContain('aria-labelledby="account-heading"');
    expect(html).toContain('scope="col"');
  });
});
