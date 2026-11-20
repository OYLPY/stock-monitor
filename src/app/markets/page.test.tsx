import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MarketsPage from "@/app/markets/page";
import { getLocalDatabasePath, openDatabase } from "@/db";
import { importLocalMarketCsv } from "@/features/market-data/local-import";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("market dashboard", () => {
  it("shows one concise empty state without inventing quotes", async () => {
    const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
    const testDataDirectory = await mkdtemp(
      join(tmpdir(), "stock-monitor-market-page-"),
    );
    process.env.STOCK_MONITOR_DATA_DIR = testDataDirectory;

    try {
      const page = await MarketsPage({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(page);

      expect(html).toContain('<h1 class="sr-only">市场监测</h1>');
      expect(html).toContain("选择市场");
      expect(html).toContain("美股暂无日线");
      expect(html).toContain(">日股</button>");
      expect(html.match(/role="tab"/g)).toHaveLength(2);
      expect(html).toContain("导入 CSV");
      expect(html).not.toContain("本机行情明细");
      expect(html).toContain("EODHD_API_TOKEN");
      expect(html).not.toContain("开闭市状态");
      expect(html).not.toContain("交易日历未接入");
      expect(html).not.toContain("SYNTHETIC-US-0001");
      expect(html).not.toContain("101.25");
    } finally {
      if (originalDataDirectory === undefined) {
        delete process.env.STOCK_MONITOR_DATA_DIR;
      } else {
        process.env.STOCK_MONITOR_DATA_DIR = originalDataDirectory;
      }
      await rm(testDataDirectory, { recursive: true, force: true });
    }
  });

  it("plots the newest imported snapshot while preserving its verification status", async () => {
    const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
    const testDataDirectory = await mkdtemp(
      join(tmpdir(), "stock-monitor-market-page-data-"),
    );
    process.env.STOCK_MONITOR_DATA_DIR = testDataDirectory;

    try {
      const database = await openDatabase(getLocalDatabasePath());
      try {
        importLocalMarketCsv(database, {
          market: "US",
          symbol: "AAPL",
          bytes: new TextEncoder().encode(
            [
              "Date,Open,High,Low,Close,Volume",
              "2024-01-02,10.1,11,9.9,10.5,1000",
              "2024-01-03,10.5,11.2,10.2,11,1500",
            ].join("\n"),
          ),
        });
      } finally {
        database.client.close();
      }

      const page = await MarketsPage({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(page);

      expect(html).toContain('role="img"');
      expect(html).toContain("AAPL");
      expect(html).toContain('data-status="NOT_VERIFIED"');
      expect(html).toContain(">未核验</span>");
      expect(html).toContain("2024-01-03");
      expect(html).toContain("查看本机行情明细（2 条）");
      expect(html).not.toContain("101.25");
    } finally {
      if (originalDataDirectory === undefined) {
        delete process.env.STOCK_MONITOR_DATA_DIR;
      } else {
        process.env.STOCK_MONITOR_DATA_DIR = originalDataDirectory;
      }
      await rm(testDataDirectory, { recursive: true, force: true });
    }
  });
});
