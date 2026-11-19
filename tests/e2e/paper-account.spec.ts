import { expect, test } from "@playwright/test";

test("opens a paper account once, records its fixed cash, and stays usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/backtests?tab=account");

  await expect(
    page.getByRole("heading", { name: "纸面账本未建立" }),
  ).toBeVisible();
  const createAccount = page.getByRole("button", { name: "建立纸面账户" });
  await createAccount.focus();
  await page.keyboard.press("Enter");

  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("1,000,000 JPY 初始现金");
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();

  await page.route("**/api/v1/paper-account/initialize", async (route) => {
    await route.fulfill({ status: 500, body: "{}" });
  });
  await createAccount.click();
  await confirmation.getByRole("button", { name: "确认开户" }).click();
  await expect(confirmation).toContainText("建立纸面账户失败");
  await page.unroute("**/api/v1/paper-account/initialize");
  await confirmation.getByRole("button", { name: "重试开户" }).click();
  await expect(page.getByText("JPY 1,000,000", { exact: true })).toBeVisible();
  await expect(page.getByText("JPY 20,000")).toBeVisible();
  await expect(page.getByRole("row", { name: /账户开户/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "建立纸面账户" })).toHaveCount(
    0,
  );

  await page.reload();
  await expect(page.getByText("JPY 1,000,000", { exact: true })).toBeVisible();
  await expect(page.getByText("JPY 20,000")).toBeVisible();
  await expect(page.getByText("NOT_VERIFIED · 估值引擎未接入")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
