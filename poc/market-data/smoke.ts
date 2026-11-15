import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

interface SyntheticBar {
  fixtureId: string;
  sourceId: string;
  publisher: string;
  market: string;
  symbol: string;
  currency: string;
  dataCategory: string;
  marketTime: string;
  collectedAt: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  dataStatus: string;
  verificationLevel: string;
}

async function run() {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/synthetic-us-eod.json", import.meta.url),
      "utf8",
    ),
  ) as SyntheticBar;

  assert.equal(fixture.sourceId, "fixture.synthetic");
  assert.match(fixture.symbol, /^SYNTHETIC-/);
  assert.equal(fixture.dataStatus, "FIXTURE");
  assert.equal(fixture.verificationLevel, "DEMO_ONLY");
  assert.ok(Number.isFinite(Date.parse(fixture.marketTime)));
  assert.ok(Number.isFinite(Date.parse(fixture.collectedAt)));
  for (const price of [
    fixture.open,
    fixture.high,
    fixture.low,
    fixture.close,
  ]) {
    assert.match(price, /^\d+\.\d{2}$/);
  }
  assert.match(fixture.volume, /^\d+$/);

  const providerResult = {
    sourceId: "edinet-v2",
    sourceStatus: "UNAVAILABLE",
    taskStatus: "BLOCKED_EXTERNAL",
    reason: "credential_not_supplied_to_offline_poc",
    record: null,
    externalRequests: 0,
  };

  assert.equal(providerResult.taskStatus, "BLOCKED_EXTERNAL");
  assert.equal(providerResult.sourceStatus, "UNAVAILABLE");
  assert.equal(providerResult.record, null);
  assert.equal(providerResult.externalRequests, 0);

  process.stdout.write(
    `${JSON.stringify({
      mode: "offline-market-data",
      outcome: "passed",
      fixture: {
        id: fixture.fixtureId,
        sourceId: fixture.sourceId,
        dataStatus: fixture.dataStatus,
        verificationLevel: fixture.verificationLevel,
      },
      providerProbe: "NOT_RUN",
      providerStateExample: providerResult,
      credentialsRead: false,
      externalRequests: 0,
      realMarketData: "none",
    })}\n`,
  );
}

run().catch((error: unknown) => {
  process.stdout.write(
    `${JSON.stringify({
      mode: "offline-market-data",
      outcome: "failed",
      error: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    })}\n`,
  );
  process.exitCode = 1;
});
