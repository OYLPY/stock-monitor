import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("home page", () => {
  it("shows an unverified empty state without inventing market results", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain('id="main-content"');
    expect(html).toContain("NOT_VERIFIED");
    expect(html).toContain("尚未接入可核验的数据源");
    expect(html).toContain("不会用示例价格或模拟收益填充此页面");
    expect(html).not.toContain("AAPL");
    expect(html).not.toContain("¥100");
  });
});
