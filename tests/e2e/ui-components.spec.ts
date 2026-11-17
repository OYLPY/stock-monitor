import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/markets",
  "/events",
  "/reports",
  "/backtests",
  "/settings",
  "/tasks",
];

test("all workbench pages retain a heading and fit desktop and narrow screens", async ({
  page,
}) => {
  for (const route of routes) {
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(route);
    await expect(page.locator("h1#main-content")).toBeVisible();

    if (route === "/") {
      const sidebar = page.locator('[data-slot="sidebar"][data-state]');
      await expect(sidebar).toHaveAttribute("data-state", "expanded");
      await page.getByRole("button", { name: "切换主导航" }).click();
      await expect(sidebar).toHaveAttribute("data-state", "collapsed");
      await page.getByRole("button", { name: "切换主导航" }).click();
      await expect(sidebar).toHaveAttribute("data-state", "expanded");
    }

    await page.setViewportSize({ width: 320, height: 812 });
    if (route === "/") {
      await page.getByRole("button", { name: "切换主导航" }).click();
      await expect(
        page.getByRole("navigation", { name: "主导航" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "关闭主导航" }).click();
    }
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(
      widths.document,
      `${route} should not overflow at 320px`,
    ).toBeLessThanOrEqual(widths.viewport);
  }
});

test("shadcn Select controls support keyboard use and preserve GET filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/reports");

  const reportType = page.getByRole("combobox", { name: "报告类型" });
  await reportType.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "全部类型" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "全部类型" })).toBeHidden();

  await reportType.click();
  await page.getByRole("option", { name: "异常报告" }).click();
  await page
    .getByRole("searchbox", { name: "搜索报告、候选或证据编号" })
    .fill("ui-comp-01-empty-result");
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("type") === "ANOMALY"),
    page.getByRole("button", { name: "应用筛选" }).click(),
  ]);
  expect(new URL(page.url()).searchParams.get("q")).toBe(
    "ui-comp-01-empty-result",
  );

  await page.goto("/events");
  await page.getByRole("combobox", { name: "市场" }).click();
  await page.getByRole("option", { name: "日本市场" }).click();
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("market") === "JP"),
    page.getByRole("button", { name: "应用筛选" }).click(),
  ]);
});
