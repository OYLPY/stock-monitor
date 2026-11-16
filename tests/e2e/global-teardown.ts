import { rm } from "node:fs/promises";

export default async function globalTeardown() {
  const dataDirectory = process.env.STOCK_MONITOR_E2E_DATA_DIR;
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}
