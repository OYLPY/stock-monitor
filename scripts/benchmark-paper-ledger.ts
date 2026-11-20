import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { backupDatabase, restoreDatabase } from "../src/db/backup.ts";
import { openDatabase } from "../src/db/index.ts";
import { createTestDatabase } from "../src/db/test-database.ts";
import {
  initializeDefaultPaperAccount,
  listPaperAccountLedger,
} from "../src/db/paper-account-repository.ts";
import { auditPaperLedger } from "../src/features/paper/audit.ts";
import { readPaperLedger } from "../src/features/paper/ledger.ts";

const fixture = await createTestDatabase();

try {
  const { database } = fixture;
  database.client.pragma("synchronous = OFF");
  const account = initializeDefaultPaperAccount(database);
  const seedLedger = database.client.transaction(() => {
    database.client
      .prepare(
        `
        WITH RECURSIVE sequence(value) AS (
          SELECT 2 UNION ALL SELECT value + 1 FROM sequence WHERE value < 100000
        )
        INSERT INTO ledger_events (
          id, account_id, sequence_no, event_type, idempotency_key,
          effective_at_ms, recorded_at_ms, rule_version
        )
          SELECT 'event-' || printf('%08d', value), ?, value, 'FEE',
            'benchmark-' || value, ? + value, ? + value, 'paper-fee-v1'
        FROM sequence
      `,
      )
      .run(account.id, account.initializedAtMs, account.initializedAtMs);
    database.client
      .prepare(
        `
        WITH RECURSIVE sequence(value) AS (
          SELECT 2 UNION ALL SELECT value + 1 FROM sequence WHERE value < 100000
        )
        INSERT INTO cash_ledger_entries (
          id, ledger_event_id, bucket, currency_code, currency_scale, amount_minor
        )
        SELECT 'cash-' || printf('%08d', value),
          'event-' || printf('%08d', value), 'SETTLED', 'JPY', 0, -1
        FROM sequence
      `,
      )
      .run();
  });
  seedLedger();

  database.client
    .prepare(
      `
      INSERT INTO sources (
        id, source_key, publisher, source_type, authority_role,
        license_status, credential_requirement, registered_at_ms
      ) VALUES (
        'fixture-source', 'benchmark-fixture', 'synthetic benchmark',
        'OTHER', 'FIXTURE', 'UNKNOWN', 'UNKNOWN', 0
      )
    `,
    )
    .run();
  database.client
    .prepare(
      `
      INSERT INTO source_records (
        id, source_id, record_key, record_type, record_version,
        collected_at_ms, content_hash_sha256, data_class
      ) VALUES (
        'fixture-record', 'fixture-source', 'bars-250k', 'MARKET_QUOTE',
        1, 0, ?, 'FIXTURE'
      )
    `,
    )
    .run("a".repeat(64));
  const seedBars = database.client.transaction(() => {
    database.client
      .prepare(
        `
        WITH RECURSIVE sequence(value) AS (
          SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 250000
        )
        INSERT INTO market_price_bars (
          id, market_code, symbol, trading_date, open_mantissa, high_mantissa,
          low_mantissa, close_mantissa, price_scale, volume_shares,
          source_record_id, collected_at_ms
        )
        SELECT 'bar-' || printf('%08d', value), 'US', 'BENCH',
          date('2000-01-01', printf('+%d days', value - 1)),
          100, 102, 99, 101, 0, 1000, 'fixture-record', 0
        FROM sequence
      `,
      )
      .run();
  });
  seedBars();

  const reads = [];
  let returnedRows = 0;
  for (let sample = 0; sample < 30; sample++) {
    const startedAt = performance.now();
    returnedRows = listPaperAccountLedger(database, 1)?.entries.length ?? 0;
    reads.push(Math.round((performance.now() - startedAt) * 100) / 100);
  }
  const auditStartedAt = performance.now();
  const audit = auditPaperLedger(database);
  const auditMs = Math.round((performance.now() - auditStartedAt) * 100) / 100;
  let replayError: string | null = null;
  try {
    readPaperLedger(database);
  } catch (error) {
    replayError = error instanceof Error ? error.message : String(error);
  }

  database.client.close();
  const restartStartedAt = performance.now();
  const reopened = await openDatabase(fixture.filePath);
  const restartMs =
    Math.round((performance.now() - restartStartedAt) * 100) / 100;
  const reopenedAudit = auditPaperLedger(reopened);

  const backupDirectory = join(dirname(fixture.filePath), "benchmark-backup");
  const backupStartedAt = performance.now();
  const backup = await backupDatabase(fixture.filePath, backupDirectory);
  const backupMs =
    Math.round((performance.now() - backupStartedAt) * 100) / 100;

  const restoredFile = join(
    dirname(fixture.filePath),
    "benchmark-restored.sqlite",
  );
  const restoreStartedAt = performance.now();
  await restoreDatabase(backupDirectory, restoredFile);
  const restoreMs =
    Math.round((performance.now() - restoreStartedAt) * 100) / 100;
  const restored = await openDatabase(restoredFile);
  const restoredAudit = auditPaperLedger(restored);
  const restoredRows = {
    ledgerEvents: Number(
      restored.client
        .prepare("SELECT count(*) FROM ledger_events")
        .pluck()
        .get(),
    ),
    marketPriceBars: Number(
      restored.client
        .prepare("SELECT count(*) FROM market_price_bars")
        .pluck()
        .get(),
    ),
  };
  const pageCount = Number(
    reopened.client.pragma("page_count", { simple: true }),
  );
  const pageSize = Number(
    reopened.client.pragma("page_size", { simple: true }),
  );
  const sqliteVersion = reopened.client
    .prepare("SELECT sqlite_version() AS version")
    .get();
  restored.client.close();
  reopened.client.close();

  const sortedReads = [...reads].sort((left, right) => left - right);

  console.log(
    JSON.stringify({
      fixture: "synthetic temporary SQLite only; no market truth",
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryBytes: totalmem(),
      node: process.version,
      sqlite: sqliteVersion,
      ledgerEvents: 100_000,
      marketPriceBars: 250_000,
      readSamples: reads.length,
      databaseBytes: pageCount * pageSize,
      returnedRows,
      readsMs: reads,
      p95Ms: sortedReads[Math.ceil(sortedReads.length * 0.95) - 1],
      syntheticAuditStatus: audit?.ledger.status,
      syntheticAuditIssues: audit?.ledger.issueCodes,
      syntheticAuditMs: auditMs,
      syntheticReplayError: replayError,
      restartMs,
      reopenedLedgerStatus: reopenedAudit?.ledger.status,
      backupMs,
      backupStatus: backup.status,
      restoreMs,
      restoredLedgerStatus: restoredAudit?.ledger.status,
      restoredRows,
    }),
  );
} finally {
  await fixture.cleanup();
}
