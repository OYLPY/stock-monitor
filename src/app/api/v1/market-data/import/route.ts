import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { importLocalMarketCsv } from "@/features/market-data/local-import";
import { ApiError, errorResponse, successResponse } from "@/lib/api/errors";
import { assertLocalRequest } from "@/lib/security/local-request";
import {
  LocalCsvError,
  MAX_LOCAL_CSV_BYTES,
} from "@/providers/market-data/local-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const importFieldsSchema = z.strictObject({
  market: z.enum(["JP", "US"]),
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/),
  rightsConfirmed: z.literal(true),
});

const MAX_IMPORT_REQUEST_BYTES = MAX_LOCAL_CSV_BYTES + 64 * 1024;

async function readMultipartBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("VALIDATION_FAILED");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMPORT_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size limit remains authoritative if the client already closed the stream.
        }
        throw new ApiError("REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("VALIDATION_FAILED", [
      { path: "file", code: "INVALID_MULTIPART" },
    ]);
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validationError(error: z.ZodError) {
  return new ApiError(
    "VALIDATION_FAILED",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  );
}

export async function POST(request: Request) {
  const htmlFallback = request.headers.get("accept")?.includes("text/html");
  try {
    assertLocalRequest(request);
    const contentLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_IMPORT_REQUEST_BYTES
    ) {
      throw new ApiError("REQUEST_TOO_LARGE");
    }
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;")) {
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
    }

    let form: FormData;
    try {
      form = await new Response(await readMultipartBody(request), {
        headers: { "content-type": contentType },
      }).formData();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("VALIDATION_FAILED", [
        { path: "file", code: "INVALID_MULTIPART" },
      ]);
    }
    const allowedFields = ["market", "symbol", "rightsConfirmed", "file"];
    if (
      [...form.keys()].some((key) => !allowedFields.includes(key)) ||
      allowedFields.some((key) => form.getAll(key).length !== 1)
    ) {
      throw new ApiError("VALIDATION_FAILED");
    }

    const fields = importFieldsSchema.safeParse({
      market: form.get("market"),
      symbol: form.get("symbol"),
      rightsConfirmed: form.get("rightsConfirmed") === "on",
    });
    if (!fields.success) throw validationError(fields.error);

    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv")) {
      throw new ApiError("VALIDATION_FAILED", [
        { path: "file", code: "CSV_FILE_REQUIRED" },
      ]);
    }
    if (file.size > MAX_LOCAL_CSV_BYTES)
      throw new ApiError("REQUEST_TOO_LARGE");

    const database = await openDatabase(getLocalDatabasePath());
    try {
      const result = importLocalMarketCsv(database, {
        market: fields.data.market,
        symbol: fields.data.symbol.toUpperCase(),
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (htmlFallback) {
        return new Response(null, {
          status: 303,
          headers: { Location: "/markets?import=success" },
        });
      }
      return successResponse(result);
    } finally {
      database.client.close();
    }
  } catch (error) {
    const cause =
      error instanceof LocalCsvError
        ? new ApiError("VALIDATION_FAILED", [
            { path: "file", code: error.code },
          ])
        : error instanceof ApiError
          ? error
          : new ApiError("INTERNAL_ERROR");
    if (htmlFallback) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/markets?import=error" },
      });
    }
    return errorResponse(cause);
  }
}
