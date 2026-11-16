import { expect, test } from "@playwright/test";

const secretSentinel = "P06_06_PLAYWRIGHT_SECRET_SENTINEL";

test("settings backup and task status are operable and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  await expect(page).toHaveTitle(/设置/);
  await expect(
    page.getByRole("heading", { name: "设置", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("本机模型执行器")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secretSentinel);
  expect(await page.content()).not.toContain(secretSentinel);

  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();

  const backupButton = page.getByRole("button", { name: "创建备份" });
  const backupResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/backup",
  );
  for (let attempts = 0; attempts < 16; attempts += 1) {
    await page.keyboard.press("Tab");
    if (
      await backupButton.evaluate((button) => button === document.activeElement)
    ) {
      break;
    }
  }
  await expect(backupButton).toBeFocused();
  await page.keyboard.press("Enter");
  const backupResponse = await backupResponsePromise;
  expect(backupResponse.status()).toBe(200);

  const status = page.getByRole("status");
  await expect(status).toContainText("备份已创建：");
  await expect(status).toContainText("backups");
  await expect(status).not.toContainText(secretSentinel);

  await page.route("**/api/v1/backup", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "BACKUP_FAILED", message: secretSentinel },
      }),
    }),
  );
  await backupButton.click();
  await expect(status).toContainText("备份失败");
  await expect(status).not.toContainText(secretSentinel);

  await page.getByRole("link", { name: "任务与通知" }).click();
  await expect(
    page.getByRole("heading", { name: "任务与通知", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("执行日志", { exact: true })).toBeVisible();
  await expect(page.getByText("通知记录与已读状态尚未接入。")).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
