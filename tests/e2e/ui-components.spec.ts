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
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeAttached();

    if (route === "/") {
      const sidebar = page.locator('[data-slot="sidebar"][data-state]');
      await expect(sidebar).toHaveAttribute("data-state", "expanded");
      await page.getByRole("button", { name: "切换主导航" }).click();
      await expect(sidebar).toHaveAttribute("data-state", "collapsed");
      await expect(sidebar).toHaveAttribute("data-collapsible", "offcanvas");
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

test("backtest date picker and account tab use their shadcn interactions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/backtests");

  const startDateButton = page.getByRole("button", { name: "选择开始日期" });
  await startDateButton.click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");

  const researchTab = page.getByRole("tab", { name: "回测研究" });
  const accountTab = page.getByRole("tab", { name: "纸面账户" });
  await expect(researchTab).toHaveAttribute("aria-selected", "true");
  await accountTab.click();
  await expect(accountTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "纸面账户与账本" }),
  ).toBeVisible();
});

test("keeps the app header sticky while page content scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/backtests");

  const header = page.locator("main > header");
  await expect(header).toHaveCSS("position", "sticky");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(header).toBeInViewport();
});
