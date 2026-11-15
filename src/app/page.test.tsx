import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("home page", () => {
  it("renders the research workbench heading without requiring external data", () => {
    expect(renderToStaticMarkup(createElement(Home))).toContain(
      "<h1>量化研究工作台</h1>",
    );
  });
});
