import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MarketsPage from "@/app/markets/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("market dashboard", () => {
  it("reports unavailable calendars and quotes without inventing prices", async () => {
    const originalDataDirectory = process.env.STOCK_MONITOR_DATA_DIR;
    const testDataDirectory = await mkdtemp(
      join(tmpdir(), "stock-monitor-market-page-"),
    );
    process.env.STOCK_MONITOR_DATA_DIR = testDataDirectory;

    try {
      const page = await MarketsPage({ searchParams: Promise.resolve({}) });
      const html = renderToStaticMarkup(page);

      expect(html).toContain('<h1 class="sr-only">市场监测</h1>');
      expect(html).toContain("导入本机行情 CSV");
      expect(html).toContain("本机导入记录");
      expect(html).toContain("美国市场");
      expect(html).toContain("日本市场");
      expect(html).toContain("America/New_York");
      expect(html).toContain("Asia/Tokyo");
      expect(html).toContain("开闭市状态");
      expect(html).toContain("交易日历未接入");
      expect(html).toContain("无可核验快照");
      expect(html).toContain("未接入 / 无采集记录");
      expect(html).toContain("NOT_VERIFIED");
      expect(html).toContain("FIXTURE");
      expect(html).toContain("DELAYED");
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
});
