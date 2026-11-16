import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MarketsPage from "@/app/markets/page";

describe("market dashboard", () => {
  it("reports unavailable calendars and quotes without inventing prices", () => {
    const html = renderToStaticMarkup(createElement(MarketsPage));

    expect(html).toContain('id="main-content"');
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
  });
});
