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

  const successToast = page.getByRole("region", { name: /Notifications/ });
  await expect(successToast).toContainText("备份已创建");
  await expect(successToast).toContainText("backups");
  await expect(successToast).not.toContainText(secretSentinel);

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
  const backupError = page.getByRole("alertdialog");
  await expect(backupError).toContainText("备份失败");
  await expect(backupError).not.toContainText(secretSentinel);
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(backupError).toBeHidden();

  await page.getByRole("link", { name: "任务与通知" }).click();
  await expect(
    page.getByRole("heading", { name: "任务与通知", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务队列" })).toBeVisible();
  await expect(page.getByText("本机 Worker 运行中")).toBeVisible();
  const weeklyTask = page
    .getByRole("row")
    .filter({ hasText: "周度审计" })
    .filter({ hasText: "排队中" })
    .first();
  await expect(weeklyTask).toContainText("排队中");
  const weeklyTaskId = await weeklyTask.locator("code").textContent();
  if (!weeklyTaskId) throw new Error("weekly_task_id_missing");

  await page.reload();
  const persistedWeeklyTask = page
    .getByRole("row")
    .filter({ hasText: weeklyTaskId });
  await expect(persistedWeeklyTask).toContainText("排队中");
  await persistedWeeklyTask.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("取消任务？");
  await page.getByRole("button", { name: "确认取消" }).click();
  await expect(
    page.getByRole("region", { name: /Notifications/ }),
  ).toContainText("任务已取消");
  await expect(persistedWeeklyTask).toContainText("已跳过");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole("button", { name: "切换主导航" }).click();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("button", { name: "关闭主导航" }).click();
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
