import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/app-shell";

const { mockPathname } = vi.hoisted(() => ({
  mockPathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockPathname,
}));

describe("AppShell", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/");
  });

  it("renders semantic navigation and one main landmark", () => {
    const html = renderToStaticMarkup(
      createElement(AppShell, null, createElement("h1", null, "总览")),
    );

    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/id="main-content"/g)).toHaveLength(1);
    expect(html).toContain('<nav aria-label="主导航">');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/markets"');
    expect(html).toContain('href="/reports"');
    expect(html).toContain('href="/backtests"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('href="/tasks"');
    expect(html).not.toContain('href="#"');
  });

  it("marks the market dashboard as the active page", () => {
    mockPathname.mockReturnValue("/markets");

    const html = renderToStaticMarkup(
      createElement(AppShell, null, createElement("h1", null, "市场监测")),
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/markets"/);
  });

  it("marks the reports workspace as the active page", () => {
    mockPathname.mockReturnValue("/reports");

    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        null,
        createElement("h1", null, "晨报与策略研究"),
      ),
    );

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/reports"/);
  });

  it("marks the backtests workspace as the active page", () => {
    mockPathname.mockReturnValue("/backtests");

    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        null,
        createElement("h1", null, "回测与纸面账户"),
      ),
    );

    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/backtests"/);
  });
});
