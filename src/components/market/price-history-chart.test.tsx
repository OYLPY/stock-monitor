import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PriceHistoryChart } from "@/components/market/price-history-chart";

describe("PriceHistoryChart", () => {
  it("keeps the chart empty when no verifiable history is available", () => {
    const html = renderToStaticMarkup(
      createElement(PriceHistoryChart, {
        collectedAtMs: null,
        currency: "USD",
        dataStatus: "NOT_VERIFIED",
        market: "US",
        marketLabel: "美国市场",
        points: [],
        sourceName: "未接入行情来源",
      }),
    );

    expect(html).toContain('data-status="NOT_VERIFIED"');
    expect(html).toContain(">未核验</span>");
    expect(html).toContain("无历史交易日");
    expect(html).toContain("无采集记录");
    expect(html).toContain("没有价格序列时不绘制趋势线");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("101.25");
  });

  it("renders an accessible chart with a collapsible semantic time-and-price table", () => {
    const html = renderToStaticMarkup(
      createElement(PriceHistoryChart, {
        collectedAtMs: Date.parse("2025-01-06T00:00:00.000Z"),
        currency: "USD",
        dataStatus: "HISTORICAL",
        market: "US",
        marketLabel: "美国市场",
        points: [
          { tradingDate: "2025-01-02", close: 100 },
          { tradingDate: "2025-01-03", close: 102.5 },
        ],
        sourceName: "核验后的历史来源",
      }),
    );

    expect(html).toContain('role="img"');
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain('data-slot="collapsible"');
    expect(html).toContain('data-slot="collapsible-trigger"');
    expect(html).toContain('data-slot="chart"');
    expect(html).toContain("查看图表数据表（2 条）");
    expect(html).toContain("历史来源");
    expect(html).toContain("America/New_York");
    expect(html).toContain('data-status="HISTORICAL"');
    expect(html).toContain(">历史行情</span>");
    expect(html).toContain("2025-01-03 · America/New_York");
    expect(html).toContain("EOD 收盘价按供应商交易日期显示");
  });

  it("handles a constant single-point fixture and marks it demo-only", () => {
    const html = renderToStaticMarkup(
      createElement(PriceHistoryChart, {
        collectedAtMs: Date.parse("2025-01-06T00:00:00.000Z"),
        currency: "JPY",
        dataStatus: "FIXTURE",
        market: "JP",
        marketLabel: "日本市场",
        points: [{ tradingDate: "2025-01-03", close: 100 }],
        sourceName: "仅供测试的合成来源",
      }),
    );

    expect(html).toContain('data-status="FIXTURE"');
    expect(html).toContain("仅供演示");
    expect(html).not.toContain("DEMO_ONLY");
    expect(html).toContain("Asia/Tokyo");
    expect(html).toContain("日本市场收盘价历史");
    expect(html).toContain('role="img"');
    expect(html).toContain('data-slot="chart"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
