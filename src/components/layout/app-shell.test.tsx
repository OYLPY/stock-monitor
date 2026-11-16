import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell", () => {
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
    expect(html).not.toContain('href="#"');
  });
});
