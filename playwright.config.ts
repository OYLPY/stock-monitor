import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const testDataDirectory = mkdtempSync(
  join(tmpdir(), "stock-monitor-p06-06-e2e-"),
);
const secretSentinel = "P06_06_PLAYWRIGHT_SECRET_SENTINEL";

process.env.STOCK_MONITOR_E2E_DATA_DIR = testDataDirectory;
process.env.PLAYWRIGHT_SECRET_SENTINEL = secretSentinel;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3003",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "pnpm start --port 3003",
    url: "http://127.0.0.1:3003/settings",
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      STOCK_MONITOR_DATA_DIR: testDataDirectory,
      OPENAI_API_KEY: secretSentinel,
    },
  },
});
