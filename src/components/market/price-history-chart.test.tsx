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

    expect(html).toContain("NOT_VERIFIED");
    expect(html).toContain("无行情时间戳");
    expect(html).toContain("无采集记录");
    expect(html).toContain("没有价格序列时不绘制趋势线");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("101.25");
  });

  it("renders an accessible chart with a semantic time-and-price table", () => {
    const firstMarketTimestamp = Date.parse("2025-01-02T21:00:00.000Z");
    const html = renderToStaticMarkup(
      createElement(PriceHistoryChart, {
        collectedAtMs: Date.parse("2025-01-06T00:00:00.000Z"),
        currency: "USD",
        dataStatus: "HISTORICAL",
        market: "US",
        marketLabel: "美国市场",
        points: [
          { marketAtMs: firstMarketTimestamp, close: 100 },
          { marketAtMs: Date.parse("2025-01-03T21:00:00.000Z"), close: 102.5 },
        ],
        sourceName: "核验后的历史来源",
      }),
    );

    expect(html).toContain('role="img"');
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("<details");
    expect(html).toContain("<table");
    expect(html).toContain("收盘价（USD / 股）");
    expect(html).toContain("历史来源");
    expect(html).toContain("America/New_York");
    expect(html).toContain("HISTORICAL");
    expect(html).toContain(
      new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(firstMarketTimestamp)),
    );
  });

  it("handles a constant single-point fixture and marks it demo-only", () => {
    const html = renderToStaticMarkup(
      createElement(PriceHistoryChart, {
        collectedAtMs: Date.parse("2025-01-06T00:00:00.000Z"),
        currency: "JPY",
        dataStatus: "FIXTURE",
        market: "JP",
        marketLabel: "日本市场",
        points: [
          { marketAtMs: Date.parse("2025-01-03T06:30:00.000Z"), close: 100 },
        ],
        sourceName: "仅供测试的合成来源",
      }),
    );

    expect(html).toContain("FIXTURE");
    expect(html).toContain("DEMO_ONLY");
    expect(html).toContain("Asia/Tokyo");
    expect(html).toContain("日本市场收盘价历史");
    expect(html).not.toMatch(/NaN|Infinity/);
    const pointY = Number(/<circle[^>]*cy="([^"]+)"/.exec(html)?.[1]);
    expect(pointY).toBeGreaterThan(20);
    expect(pointY).toBeLessThan(232);
  });
});
