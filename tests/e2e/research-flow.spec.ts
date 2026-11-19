import { expect, test } from "@playwright/test";

test("archives and displays a local fixture report without implying market data or trades", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.goto("/reports?q=P12-03%20E2E%20Fixture");

  const title = page.getByRole("heading", {
    name: "P12-03 E2E Fixture：风控否决与证据展示",
  });
  await expect(title).toBeVisible();
  const reportCard = page.locator('[data-slot="card"]').filter({ has: title });
  await expect(reportCard).toContainText("仅演示 · DEMO_ONLY");
  await expect(reportCard).toContainText("Fixture");
  await expect(reportCard).toContainText("REJECTED");
  await expect(reportCard).toContainText(
    "E2E Fixture 风险否决展示；不是实际交易风险裁决。",
  );
  await expect(reportCard).toContainText("策略候选（0 / 3）");

  const evidenceSection = page.getByRole("button", {
    name: "证据与研究判断",
  });
  await evidenceSection.click();
  await expect(reportCard).toContainText("E2E Fixture 记录；不是市场事实。");
  const facts = reportCard
    .getByRole("heading", { name: /^事实/ })
    .locator("..");
  await expect(facts.locator("code")).toHaveText(/^[0-9a-f-]{36}$/i);

  const sourceSection = page.getByRole("button", {
    name: "来源覆盖、限制与账本状态",
  });
  await sourceSection.click();
  await expect(reportCard).toContainText("P12-03 E2E Fixture 来源");
  await expect(reportCard).toContainText(
    "只用于测试来源追溯，不代表真实市场数据。",
  );

  const screenshotPath = testInfo.outputPath("p12-03-fixture-report.png");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("p12-03-fixture-report.png", {
    path: screenshotPath,
    contentType: "image/png",
  });
});
