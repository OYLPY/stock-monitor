import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { syncUsMarketHistory } from "@/features/market-data/us-provider";
import { ApiError, errorResponse, successResponse } from "@/lib/api/errors";
import { assertLocalRequest } from "@/lib/security/local-request";
import { EodhdError } from "@/providers/us-market/eodhd";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_024;
const requestSchema = z.strictObject({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]*$/),
});

async function readJsonBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_JSON");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError("REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_JSON");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("INVALID_JSON");
  }
}

function mapProviderError(error: unknown) {
  if (!(error instanceof EodhdError)) return new ApiError("INTERNAL_ERROR");
  switch (error.code) {
    case "INVALID_SYMBOL":
      return new ApiError("VALIDATION_FAILED", [
        { path: "symbol", code: error.code },
      ]);
    case "CREDENTIAL_MISSING":
      return new ApiError("MARKET_DATA_NOT_CONFIGURED");
    case "DAILY_LIMIT_REACHED":
      return new ApiError("MARKET_DATA_DAILY_LIMIT");
    case "CREDENTIAL_REJECTED":
      return new ApiError("MARKET_DATA_CREDENTIAL_REJECTED");
    case "ACCESS_NOT_ENTITLED":
      return new ApiError("MARKET_DATA_ACCESS_NOT_ENTITLED");
    case "SYMBOL_UNAVAILABLE":
      return new ApiError("MARKET_DATA_SYMBOL_UNAVAILABLE");
    case "INVALID_RESPONSE":
      return new ApiError("MARKET_DATA_INVALID_RESPONSE");
    case "UNAVAILABLE":
      return new ApiError("MARKET_DATA_UNAVAILABLE");
  }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new ApiError("REQUEST_TOO_LARGE");
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
    }

    const input = requestSchema.safeParse(await readJsonBody(request));
    if (!input.success) throw new ApiError("VALIDATION_FAILED");

    const database = await openDatabase(getLocalDatabasePath());
    try {
      const result = await syncUsMarketHistory(database, {
        symbol: input.data.symbol,
        token: process.env.EODHD_API_TOKEN,
      });
      return successResponse(result);
    } finally {
      database.client.close();
    }
  } catch (error) {
    return errorResponse(
      error instanceof EodhdError ? mapProviderError(error) : error,
    );
  }
}
