import { parseFixedDecimal } from "@/domain/primitives";

export const MAX_LOCAL_CSV_BYTES = 4 * 1024 * 1024;
const MAX_LOCAL_CSV_ROWS = 50_000;
const SQLITE_MAX_INT64 = (BigInt(1) << BigInt(63)) - BigInt(1);

export type LocalCsvErrorCode =
  | "FILE_TOO_LARGE"
  | "INVALID_UTF8"
  | "INVALID_CSV"
  | "INVALID_HEADERS"
  | "NO_DATA_ROWS"
  | "TOO_MANY_ROWS"
  | "INVALID_DATA_ROW"
  | "DUPLICATE_DATE"
  | "SYMBOL_MISMATCH";

export class LocalCsvError extends Error {
  constructor(readonly code: LocalCsvErrorCode) {
    super(code);
    this.name = "LocalCsvError";
  }
}

export type LocalPriceBar = Readonly<{
  tradingDate: string;
  csvSymbol: string | null;
  openMantissa: bigint;
  highMantissa: bigint;
  lowMantissa: bigint;
  closeMantissa: bigint;
  priceScale: number;
  volumeShares: bigint;
}>;

function pushCell(row: string[], cell: string) {
  row.push(cell);
}

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        pushCell(row, cell);
        cell = "";
        afterQuote = false;
      } else if (character === "\r" || character === "\n") {
        pushCell(row, cell);
        rows.push(row);
        if (rows.length > MAX_LOCAL_CSV_ROWS + 1) {
          throw new LocalCsvError("TOO_MANY_ROWS");
        }
        row = [];
        cell = "";
        afterQuote = false;
        if (character === "\r" && input[index + 1] === "\n") index += 1;
      } else if (character.trim() !== "") {
        throw new LocalCsvError("INVALID_CSV");
      }
      continue;
    }

    if (character === '"') {
      if (cell.length !== 0) throw new LocalCsvError("INVALID_CSV");
      quoted = true;
    } else if (character === ",") {
      pushCell(row, cell);
      cell = "";
    } else if (character === "\r" || character === "\n") {
      pushCell(row, cell);
      rows.push(row);
      if (rows.length > MAX_LOCAL_CSV_ROWS + 1) {
        throw new LocalCsvError("TOO_MANY_ROWS");
      }
      row = [];
      cell = "";
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new LocalCsvError("INVALID_CSV");
  if (cell.length > 0 || row.length > 0 || afterQuote) {
    pushCell(row, cell);
    rows.push(row);
  }
  return rows.filter((candidate) =>
    candidate.some((value) => value.trim() !== ""),
  );
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[\s_]/g, "");
}

function parseDate(value: string): string {
  const date = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new LocalCsvError("INVALID_DATA_ROW");
  const [, year, month, day] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const leapYear =
    numericYear % 4 === 0 &&
    (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericDay < 1 ||
    numericDay > daysInMonth[numericMonth - 1]
  ) {
    throw new LocalCsvError("INVALID_DATA_ROW");
  }
  return date;
}

function parseInteger(value: string): bigint {
  const text = value.trim();
  const grouped = /^\d{1,3}(?:,\d{3})+$/.test(text);
  const digits = grouped ? text.replaceAll(",", "") : text;
  if (!/^\d+$/.test(digits)) throw new LocalCsvError("INVALID_DATA_ROW");
  const result = BigInt(digits);
  if (result > SQLITE_MAX_INT64) throw new LocalCsvError("INVALID_DATA_ROW");
  return result;
}

function parsePrice(value: string) {
  const text = value.trim();
  const grouped = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text);
  try {
    const parsed = parseFixedDecimal(grouped ? text.replaceAll(",", "") : text);
    if (parsed.mantissa <= BigInt(0) || parsed.mantissa > SQLITE_MAX_INT64) {
      throw new LocalCsvError("INVALID_DATA_ROW");
    }
    return parsed;
  } catch (error) {
    if (error instanceof LocalCsvError) throw error;
    throw new LocalCsvError("INVALID_DATA_ROW");
  }
}

// shortcut: daily raw OHLCV only; add a separately validated adapter for intraday or adjusted files.
export function parseLocalOhlcvCsv(
  bytes: Uint8Array,
): readonly LocalPriceBar[] {
  if (bytes.byteLength > MAX_LOCAL_CSV_BYTES) {
    throw new LocalCsvError("FILE_TOO_LARGE");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalCsvError("INVALID_UTF8");
  }

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseRows(text);
  const [header, ...records] = rows;
  if (!header) throw new LocalCsvError("INVALID_HEADERS");

  const headers = header.map(normalizeHeader);
  const findColumn = (names: readonly string[]) =>
    headers.findIndex((value) => names.includes(value));
  const columns = {
    date: findColumn(["date"]),
    symbol: findColumn(["symbol", "ticker", "tickersymbol"]),
    open: findColumn(["open"]),
    high: findColumn(["high"]),
    low: findColumn(["low"]),
    close: findColumn(["close", "close/last"]),
    volume: findColumn(["volume", "vol"]),
  };
  if (
    [
      columns.date,
      columns.open,
      columns.high,
      columns.low,
      columns.close,
      columns.volume,
    ].some((column) => column < 0)
  ) {
    throw new LocalCsvError("INVALID_HEADERS");
  }
  if (records.length === 0) throw new LocalCsvError("NO_DATA_ROWS");
  if (records.length > MAX_LOCAL_CSV_ROWS) {
    throw new LocalCsvError("TOO_MANY_ROWS");
  }

  const seenDates = new Set<string>();
  const bars = records.map((record) => {
    if (record.length !== headers.length) {
      throw new LocalCsvError("INVALID_DATA_ROW");
    }
    const date = parseDate(record[columns.date]);
    if (seenDates.has(date)) throw new LocalCsvError("DUPLICATE_DATE");
    seenDates.add(date);
    const csvSymbol =
      columns.symbol < 0 ? null : record[columns.symbol].trim().toUpperCase();
    if (csvSymbol !== null && !/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(csvSymbol)) {
      throw new LocalCsvError("INVALID_DATA_ROW");
    }

    const open = parsePrice(record[columns.open]);
    const high = parsePrice(record[columns.high]);
    const low = parsePrice(record[columns.low]);
    const close = parsePrice(record[columns.close]);
    const volumeShares = parseInteger(record[columns.volume]);
    const priceScale = Math.max(open.scale, high.scale, low.scale, close.scale);
    const atScale = (mantissa: bigint, scale: number) =>
      mantissa * BigInt(10) ** BigInt(priceScale - scale);
    const openMantissa = atScale(open.mantissa, open.scale);
    const highMantissa = atScale(high.mantissa, high.scale);
    const lowMantissa = atScale(low.mantissa, low.scale);
    const closeMantissa = atScale(close.mantissa, close.scale);

    if (
      openMantissa > SQLITE_MAX_INT64 ||
      highMantissa > SQLITE_MAX_INT64 ||
      lowMantissa > SQLITE_MAX_INT64 ||
      closeMantissa > SQLITE_MAX_INT64 ||
      highMantissa < openMantissa ||
      highMantissa < closeMantissa ||
      highMantissa < lowMantissa ||
      lowMantissa > openMantissa ||
      lowMantissa > closeMantissa
    ) {
      throw new LocalCsvError("INVALID_DATA_ROW");
    }

    return {
      tradingDate: date,
      csvSymbol,
      openMantissa,
      highMantissa,
      lowMantissa,
      closeMantissa,
      priceScale,
      volumeShares,
    };
  });

  return bars.sort((first, second) =>
    first.tradingDate.localeCompare(second.tradingDate),
  );
}
