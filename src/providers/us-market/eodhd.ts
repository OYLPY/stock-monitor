import {
  LocalCsvError,
  parseLocalOhlcvCsv,
} from "@/providers/market-data/local-csv";
import type { LocalPriceBar } from "@/providers/market-data/local-csv";

export const EODHD_DAILY_CALL_LIMIT = 20;
export const EODHD_SOURCE_KEY = "eodhd-us-eod";
export const EODHD_REFERENCE_URL =
  "https://eodhd.com/financial-apis/api-for-historical-data-and-volumes";
export const EODHD_LICENSE_URL = "https://eodhd.com/help/personal-use";
export const EODHD_STORAGE_URL = "https://eodhd.com/help/storage";

export type MarketDataProvider = Readonly<{
  sourceKey: string;
  publisher: string;
  market: "US";
  currency: "USD";
  timeZone: "America/New_York";
  referenceUrl: string;
  licenseUrl: string;
  fetchDailyBars: (input: {
    symbol: string;
    from: string;
    to: string;
    token: string;
  }) => Promise<
    Readonly<{ bytes: Uint8Array<ArrayBuffer>; bars: readonly LocalPriceBar[] }>
  >;
}>;

export type EodhdErrorCode =
  | "INVALID_SYMBOL"
  | "DAILY_LIMIT_REACHED"
  | "CREDENTIAL_MISSING"
  | "CREDENTIAL_REJECTED"
  | "ACCESS_NOT_ENTITLED"
  | "SYMBOL_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE";

export class EodhdError extends Error {
  constructor(readonly code: EodhdErrorCode) {
    super(code);
    this.name = "EodhdError";
  }
}

export function normalizeUsSymbol(input: string) {
  const symbol = input.trim().toUpperCase().replace(/\.US$/, "");
  if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(symbol)) {
    throw new EodhdError("INVALID_SYMBOL");
  }
  return symbol;
}

async function fetchDailyBars(input: {
  symbol: string;
  from: string;
  to: string;
  token: string;
}) {
  let response: Response;
  try {
    const url = new URL(
      `https://eodhd.com/api/eod/${encodeURIComponent(input.symbol)}.US`,
    );
    url.search = new URLSearchParams({
      api_token: input.token,
      from: input.from,
      to: input.to,
      period: "d",
      order: "a",
      fmt: "csv",
    }).toString();
    response = await fetch(url, {
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
  } catch {
    throw new EodhdError("UNAVAILABLE");
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new EodhdError("CREDENTIAL_REJECTED");
    }
    if (response.status === 403) {
      throw new EodhdError("ACCESS_NOT_ENTITLED");
    }
    if (response.status === 404) {
      throw new EodhdError("SYMBOL_UNAVAILABLE");
    }
    if (response.status === 429) throw new EodhdError("DAILY_LIMIT_REACHED");
    throw new EodhdError("UNAVAILABLE");
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new EodhdError("UNAVAILABLE");
  }
  try {
    const bars = parseLocalOhlcvCsv(bytes);
    if (
      bars.length === 0 ||
      bars.length > 370 ||
      bars.some(
        (bar, index) =>
          bar.tradingDate < input.from ||
          bar.tradingDate > input.to ||
          (index > 0 && bars[index - 1].tradingDate >= bar.tradingDate),
      )
    ) {
      throw new EodhdError("INVALID_RESPONSE");
    }
    return { bytes, bars };
  } catch (error) {
    if (error instanceof EodhdError) throw error;
    if (error instanceof LocalCsvError && error.code === "NO_DATA_ROWS") {
      throw new EodhdError("SYMBOL_UNAVAILABLE");
    }
    throw new EodhdError("INVALID_RESPONSE");
  }
}

export const eodhdUsDailyProvider: MarketDataProvider = {
  sourceKey: EODHD_SOURCE_KEY,
  publisher: "EOD Historical Data",
  market: "US",
  currency: "USD",
  timeZone: "America/New_York",
  referenceUrl: EODHD_REFERENCE_URL,
  licenseUrl: EODHD_LICENSE_URL,
  fetchDailyBars,
};
