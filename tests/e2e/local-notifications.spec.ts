import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __notificationPermissionRequests: number;
  }
}

async function mockNotificationPermission(page: Page) {
  await page.addInitScript(() => {
    const permissionKey = "e2e:notification-permission";
    let permission =
      (localStorage.getItem(permissionKey) as NotificationPermission | null) ??
      "default";
    window.__notificationPermissionRequests = 0;
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => permission,
    });
    Object.defineProperty(Notification, "requestPermission", {
      configurable: true,
      value: async () => {
        window.__notificationPermissionRequests += 1;
        permission = "granted";
        localStorage.setItem(permissionKey, permission);
        return permission;
      },
    });
  });
}

test("desktop notifications stay quiet until explicitly enabled", async ({
  page,
}) => {
  await mockNotificationPermission(page);
  await page.goto("/tasks");

  const desktopNotifications = page.getByRole("switch", {
    name: "桌面通知",
  });
  await expect(desktopNotifications).toBeVisible();
  await expect(desktopNotifications).toHaveAttribute("aria-checked", "false");
  expect(
    await page.evaluate(() => window.__notificationPermissionRequests),
  ).toBe(0);
  await expect(
    page.getByText(/默认静默。|浏览器已拒绝权限。/, { exact: false }),
  ).toBeVisible();
});

test("an authorized desktop notification preference can be enabled and silenced", async ({
  page,
}) => {
  await mockNotificationPermission(page);
  await page.goto("/tasks");
  expect(await page.evaluate(() => Notification.permission)).toBe("default");

  const desktopNotifications = page.getByRole("switch", {
    name: "桌面通知",
  });
  await expect(desktopNotifications).toHaveAttribute("aria-checked", "false");
  await desktopNotifications.click();
  await expect(desktopNotifications).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("已开启。", { exact: false })).toBeVisible();

  await page.reload();
  await expect(desktopNotifications).toHaveAttribute("aria-checked", "true");
  await desktopNotifications.click();
  await expect(desktopNotifications).toHaveAttribute("aria-checked", "false");

  await page.reload();
  await expect(desktopNotifications).toHaveAttribute("aria-checked", "false");
});
