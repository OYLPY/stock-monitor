import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { marketDateAt } from "@/domain/primitives";
import { getLocalDatabasePath, openDatabase, withTransaction } from "@/db";
import {
  auditEvents,
  marketPriceBars,
  sourceRecords,
  sources,
} from "@/db/schema";
import {
  appendSourceRecord,
  recordAuditEvent,
  registerSource,
} from "@/features/evidence/repository";
import type { AppDatabase } from "@/db";
import {
  EODHD_DAILY_CALL_LIMIT,
  EODHD_SOURCE_KEY,
  EODHD_STORAGE_URL,
  eodhdUsDailyProvider,
  EodhdError,
  normalizeUsSymbol,
} from "@/providers/us-market/eodhd";

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const EODHD_REQUEST_EVENT = "EODHD_REQUEST";
const EODHD_CACHE_EVENT = "EODHD_CACHE";

function utcDay(nowMs: number) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function usageForDay(database: AppDatabase, day: string) {
  return Number(
    database.client
      .prepare(
        `SELECT COUNT(*) FROM audit_events
         WHERE entity_type = ? AND entity_id = ? AND action = 'RESERVED'`,
      )
      .pluck()
      .get(EODHD_REQUEST_EVENT, day) ?? 0,
  );
}

function sourceFor(database: AppDatabase) {
  const existing = database.orm
    .select()
    .from(sources)
    .where(eq(sources.sourceKey, eodhdUsDailyProvider.sourceKey))
    .get();
  if (existing) return existing;

  return registerSource(database, {
    sourceKey: eodhdUsDailyProvider.sourceKey,
    publisher: eodhdUsDailyProvider.publisher,
    sourceType: "DATA_VENDOR",
    authorityRole: "AUTHORIZED_VENDOR",
    referenceUrl: eodhdUsDailyProvider.referenceUrl,
    licenseUrl: EODHD_STORAGE_URL,
    licenseStatus: "VERIFIED",
    credentialRequirement: "REQUIRED",
  });
}

function dateWindow(nowMs: number) {
  const to = marketDateAt(nowMs, "US");
  const [year, month, day] = to.split("-").map(Number);
  const fromDate = new Date(Date.UTC(year - 1, month - 1, day));
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function cachedRecord(database: AppDatabase, symbol: string) {
  const source = database.orm
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.sourceKey, EODHD_SOURCE_KEY))
    .get();
  if (!source) return null;
  return (
    database.orm
      .select({
        id: sourceRecords.id,
        recordVersion: sourceRecords.recordVersion,
        contentHash: sourceRecords.contentHashSha256,
        collectedAtMs: sourceRecords.collectedAtMs,
      })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.sourceId, source.id),
          eq(sourceRecords.recordKey, `us-daily:${symbol}`),
        ),
      )
      .orderBy(desc(sourceRecords.recordVersion))
      .limit(1)
      .get() ?? null
  );
}

function lastSuccessfulSyncAt(database: AppDatabase, symbol: string) {
  return database.orm
    .select({ recordedAtMs: auditEvents.recordedAtMs })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, EODHD_CACHE_EVENT),
        eq(auditEvents.entityId, `US:${symbol}`),
        eq(auditEvents.action, "REFRESHED"),
      ),
    )
    .orderBy(desc(auditEvents.sequenceNo))
    .limit(1)
    .get()?.recordedAtMs;
}

function storedBarSummary(database: AppDatabase, recordId: string) {
  const result = database.client
    .prepare(
      `SELECT COUNT(*) AS row_count, MAX(trading_date) AS latest_date
       FROM market_price_bars WHERE source_record_id = ?`,
    )
    .get(recordId) as { row_count: bigint; latest_date: string | null };
  return {
    rowsReceived: Number(result.row_count),
    latestTradingDate: result.latest_date,
  };
}

export function getEodhdDailyUsage(database: AppDatabase, nowMs = Date.now()) {
  return {
    used: usageForDay(database, utcDay(nowMs)),
    limit: EODHD_DAILY_CALL_LIMIT,
  };
}

export async function loadEodhdDailyStatus(
  databasePath = getLocalDatabasePath(),
) {
  const database = await openDatabase(databasePath);
  try {
    return {
      configured: Boolean(process.env.EODHD_API_TOKEN?.trim()),
      ...getEodhdDailyUsage(database),
    };
  } finally {
    database.client.close();
  }
}

export async function syncUsMarketHistory(
  database: AppDatabase,
  input: { symbol: string; token: string | undefined },
) {
  const symbol = normalizeUsSymbol(input.symbol);
  const nowMs = Date.now();
  const existing = cachedRecord(database, symbol);
  const lastSyncAt = lastSuccessfulSyncAt(database, symbol);
  if (
    existing &&
    lastSyncAt !== undefined &&
    nowMs >= Number(lastSyncAt) &&
    nowMs - Number(lastSyncAt) < CACHE_TTL_MS
  ) {
    return {
      symbol,
      dataClass: "HISTORICAL" as const,
      cacheHit: true,
      rowsAdded: 0,
      ...storedBarSummary(database, existing.id),
      ...getEodhdDailyUsage(database, nowMs),
    };
  }

  const token = input.token?.trim();
  if (!token) throw new EodhdError("CREDENTIAL_MISSING");

  const day = utcDay(nowMs);
  withTransaction(database, () => {
    if (usageForDay(database, day) >= EODHD_DAILY_CALL_LIMIT) {
      throw new EodhdError("DAILY_LIMIT_REACHED");
    }
    recordAuditEvent(database, {
      entityType: EODHD_REQUEST_EVENT,
      entityId: day,
      action: "RESERVED",
      payload: { market: "US", symbol },
    });
  });

  const { from, to } = dateWindow(nowMs);
  const response = await eodhdUsDailyProvider.fetchDailyBars({
    symbol,
    from,
    to,
    token,
  });
  const contentHash = createHash("sha256").update(response.bytes).digest("hex");
  const result = withTransaction(database, () => {
    const source = sourceFor(database);
    const previous = database.orm
      .select()
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.sourceId, source.id),
          eq(sourceRecords.recordKey, `us-daily:${symbol}`),
        ),
      )
      .orderBy(desc(sourceRecords.recordVersion))
      .limit(1)
      .get();

    const replaceSnapshot =
      !previous || previous.contentHashSha256 !== contentHash;
    const sourceRecord = replaceSnapshot
      ? appendSourceRecord(database, {
          sourceId: source.id,
          recordKey: `us-daily:${symbol}`,
          recordType: "MARKET_QUOTE",
          recordVersion: (previous?.recordVersion ?? 0) + 1,
          supersedesRecordId: previous?.id ?? null,
          publishedAtMs: null,
          occurredAtMs: null,
          availableAtMs: null,
          rawTimeText:
            "EOD trading date only; response does not provide an exact publication time",
          sourceTimeZone: eodhdUsDailyProvider.timeZone,
          canonicalUrl: `https://eodhd.com/api/eod/${symbol}.US`,
          dataClass: "HISTORICAL",
          content: response.bytes,
        })
      : previous;
    let rowsAdded = 0;
    if (replaceSnapshot) {
      for (const bar of response.bars) {
        const inserted = database.orm
          .insert(marketPriceBars)
          .values({
            id: randomUUID(),
            marketCode: "US",
            symbol,
            tradingDate: bar.tradingDate,
            openMantissa: bar.openMantissa,
            highMantissa: bar.highMantissa,
            lowMantissa: bar.lowMantissa,
            closeMantissa: bar.closeMantissa,
            priceScale: bar.priceScale,
            volumeShares: bar.volumeShares,
            sourceRecordId: sourceRecord.id,
            collectedAtMs: sourceRecord.collectedAtMs,
          })
          .onConflictDoNothing()
          .run();
        rowsAdded += inserted.changes;
      }
    }

    recordAuditEvent(database, {
      entityType: EODHD_CACHE_EVENT,
      entityId: `US:${symbol}`,
      action: "REFRESHED",
      payload: {
        sourceRecordId: sourceRecord.id,
        contentHashSha256: contentHash,
        dateFrom: response.bars[0].tradingDate,
        dateTo: response.bars.at(-1)!.tradingDate,
        rowCount: response.bars.length,
      },
    });

    return {
      rowsAdded,
      ...storedBarSummary(database, sourceRecord.id),
    };
  });

  return {
    symbol,
    dataClass: "HISTORICAL" as const,
    cacheHit: false,
    ...result,
    ...getEodhdDailyUsage(database, nowMs),
  };
}
