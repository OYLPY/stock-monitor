import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { MARKET_TIME_ZONES } from "@/domain/primitives";
import type { MarketCode } from "@/domain/primitives";
import { getLocalDatabasePath, openDatabase, withTransaction } from "@/db";
import { marketPriceBars, sourceRecords, sources } from "@/db/schema";
import {
  appendSourceRecord,
  registerSource,
} from "@/features/evidence/repository";
import {
  LocalCsvError,
  parseLocalOhlcvCsv,
} from "@/providers/market-data/local-csv";
import type { LocalPriceBar } from "@/providers/market-data/local-csv";

const sourceKey = "local-csv-market-data";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceFor(database: Awaited<ReturnType<typeof openDatabase>>) {
  const existing = database.orm
    .select()
    .from(sources)
    .where(eq(sources.sourceKey, sourceKey))
    .get();
  if (existing) return existing;

  return registerSource(database, {
    sourceKey,
    publisher: "本机用户提供 CSV",
    sourceType: "OTHER",
    authorityRole: "UNKNOWN",
    referenceUrl: null,
    licenseUrl: null,
    licenseStatus: "NOT_VERIFIED",
    credentialRequirement: "NOT_REQUIRED",
  });
}

function sourceRecordFor(
  database: Awaited<ReturnType<typeof openDatabase>>,
  input: {
    sourceId: string;
    market: MarketCode;
    symbol: string;
    contentHash: string;
    content: string;
  },
) {
  const recordKey = `local-csv:${input.market}:${input.symbol}:${input.contentHash}`;
  const existing = database.orm
    .select()
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.sourceId, input.sourceId),
        eq(sourceRecords.recordKey, recordKey),
        eq(sourceRecords.recordVersion, 1),
      ),
    )
    .get();
  if (existing) return existing;

  return appendSourceRecord(database, {
    sourceId: input.sourceId,
    recordKey,
    recordType: "MARKET_QUOTE",
    recordVersion: 1,
    supersedesRecordId: null,
    publishedAtMs: null,
    occurredAtMs: null,
    availableAtMs: null,
    rawTimeText: "user-provided daily OHLCV CSV",
    sourceTimeZone: MARKET_TIME_ZONES[input.market],
    canonicalUrl: null,
    dataClass: "NOT_VERIFIED",
    content: input.content,
  });
}

function insertBars(
  database: Awaited<ReturnType<typeof openDatabase>>,
  input: {
    market: MarketCode;
    symbol: string;
    sourceRecordId: string;
    collectedAtMs: bigint;
    bars: readonly LocalPriceBar[];
  },
) {
  return withTransaction(database, () => {
    let inserted = 0;
    for (const bar of input.bars) {
      const result = database.orm
        .insert(marketPriceBars)
        .values({
          id: randomUUID(),
          marketCode: input.market,
          symbol: input.symbol,
          tradingDate: bar.tradingDate,
          openMantissa: bar.openMantissa,
          highMantissa: bar.highMantissa,
          lowMantissa: bar.lowMantissa,
          closeMantissa: bar.closeMantissa,
          priceScale: bar.priceScale,
          volumeShares: bar.volumeShares,
          sourceRecordId: input.sourceRecordId,
          collectedAtMs: input.collectedAtMs,
        })
        .onConflictDoNothing()
        .run();
      inserted += result.changes;
    }
    return inserted;
  });
}

export function importLocalMarketCsv(
  database: Awaited<ReturnType<typeof openDatabase>>,
  input: {
    market: MarketCode;
    symbol: string;
    bytes: Uint8Array;
  },
) {
  const market = input.market;
  const symbol = input.symbol.toUpperCase();
  const bars = parseLocalOhlcvCsv(input.bytes);
  if (bars.some((bar) => bar.csvSymbol !== null && bar.csvSymbol !== symbol)) {
    throw new LocalCsvError("SYMBOL_MISMATCH");
  }
  const hash = sha256(input.bytes);
  const content = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(input.bytes);
  const insertedRows = withTransaction(database, () => {
    const source = sourceFor(database);
    const sourceRecord = sourceRecordFor(database, {
      sourceId: source.id,
      market,
      symbol,
      contentHash: hash,
      content,
    });
    const insertedRows = insertBars(database, {
      market,
      symbol,
      sourceRecordId: sourceRecord.id,
      collectedAtMs: sourceRecord.collectedAtMs,
      bars,
    });
    return insertedRows;
  });

  return {
    market,
    symbol,
    rowsInFile: bars.length,
    rowsAdded: insertedRows,
    dateFrom: bars[0].tradingDate,
    dateTo: bars[bars.length - 1].tradingDate,
    dataClass: "NOT_VERIFIED" as const,
  };
}

function formatMantissa(mantissa: bigint, scale: number) {
  const digits = mantissa.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function listMarketBars(
  database: Awaited<ReturnType<typeof openDatabase>>,
  market: MarketCode,
) {
  const rows = database.orm
    .select({
      symbol: marketPriceBars.symbol,
      tradingDate: marketPriceBars.tradingDate,
      openMantissa: marketPriceBars.openMantissa,
      highMantissa: marketPriceBars.highMantissa,
      lowMantissa: marketPriceBars.lowMantissa,
      closeMantissa: marketPriceBars.closeMantissa,
      priceScale: marketPriceBars.priceScale,
      volumeShares: marketPriceBars.volumeShares,
      collectedAtMs: marketPriceBars.collectedAtMs,
      contentHash: sourceRecords.contentHashSha256,
      sourceKey: sources.sourceKey,
      publisher: sources.publisher,
      licenseStatus: sources.licenseStatus,
      dataClass: sourceRecords.dataClass,
    })
    .from(marketPriceBars)
    .innerJoin(
      sourceRecords,
      eq(marketPriceBars.sourceRecordId, sourceRecords.id),
    )
    .innerJoin(sources, eq(sourceRecords.sourceId, sources.id))
    .where(eq(marketPriceBars.marketCode, market))
    .orderBy(
      desc(marketPriceBars.tradingDate),
      desc(marketPriceBars.collectedAtMs),
      desc(marketPriceBars.id),
    )
    .limit(500)
    .all();

  const latestBySourceSymbolDate = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.sourceKey}:${row.symbol}:${row.tradingDate}`;
    if (!latestBySourceSymbolDate.has(key)) {
      latestBySourceSymbolDate.set(key, row);
    }
  }

  return [...latestBySourceSymbolDate.values()].slice(0, 100).map((row) => ({
    symbol: row.symbol,
    tradingDate: row.tradingDate,
    open: formatMantissa(row.openMantissa, row.priceScale),
    high: formatMantissa(row.highMantissa, row.priceScale),
    low: formatMantissa(row.lowMantissa, row.priceScale),
    close: formatMantissa(row.closeMantissa, row.priceScale),
    volume: row.volumeShares.toLocaleString("zh-CN"),
    collectedAtMs: Number(row.collectedAtMs),
    sourceHash: row.contentHash,
    publisher: row.publisher,
    licenseStatus: row.licenseStatus,
    dataClass: row.dataClass as
      "HISTORICAL" | "NOT_VERIFIED" | "REAL" | "DELAYED" | "FIXTURE",
  }));
}

export async function loadLocalMarketBars(
  databasePath = getLocalDatabasePath(),
) {
  const database = await openDatabase(databasePath);
  try {
    return {
      US: listMarketBars(database, "US"),
      JP: listMarketBars(database, "JP"),
    };
  } finally {
    database.client.close();
  }
}

export type LocalMarketBarRow = ReturnType<typeof listMarketBars>[number];
