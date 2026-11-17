import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("home page", () => {
  it("separates unverified market, event, and report states", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain('aria-label="研究工作区状态"');
    expect(html).toContain("NOT_VERIFIED");
    expect(html).toContain("市场监测");
    expect(html).toContain("异常与事件");
    expect(html).toContain("晨报与策略研究");
    expect(html).toContain("尚无可核验行情");
    expect(html).toContain("本机暂无事件记录");
    expect(html).toContain("尚无已保存的报告");
    expect(html).toContain('href="/markets"');
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/reports"');
    expect(html).not.toContain("AAPL");
    expect(html).not.toContain("¥100");
  });
});
