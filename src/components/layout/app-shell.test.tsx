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
      createElement(
        AppShell,
        null,
        createElement("h1", { id: "main-content", tabIndex: -1 }, "总览"),
      ),
    );

    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('<nav aria-label="主导航">');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('href="/markets"');
    expect(html).not.toContain('href="#"');
  });

  it("marks the market dashboard as the active page", () => {
    mockPathname.mockReturnValue("/markets");

    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        null,
        createElement("h1", { id: "main-content", tabIndex: -1 }, "市场监测"),
      ),
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/markets"/);
  });
});
