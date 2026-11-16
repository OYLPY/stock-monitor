import type { output, ZodType } from "zod";
import { ApiError, type ApiValidationDetail } from "./errors";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

const MAX_VALIDATION_DETAILS = 20;
const SECRET_FIELD =
  /authorization|(?:api|access)[_-]?(?:key|token)|password|secret|token/i;

function validationPath(path: PropertyKey[]): string {
  const segments = path.map((part) => {
    if (typeof part === "number" && Number.isSafeInteger(part) && part >= 0) {
      return `[${part}]`;
    }
    if (
      typeof part === "string" &&
      /^[A-Za-z_][A-Za-z\d_-]{0,63}$/.test(part) &&
      !SECRET_FIELD.test(part)
    ) {
      return part;
    }
    return "[redacted]";
  });

  return segments.join(".").replaceAll(".[", "[") || "$";
}

function validationCode(code: string): string {
  switch (code) {
    case "invalid_type":
      return "INVALID_TYPE";
    case "too_small":
      return "TOO_SMALL";
    case "too_big":
      return "TOO_BIG";
    case "unrecognized_keys":
      return "UNKNOWN_KEY";
    default:
      return "INVALID_VALUE";
  }
}

function validationDetails(
  issues: readonly { path: PropertyKey[]; code: string }[],
): ApiValidationDetail[] {
  return issues.slice(0, MAX_VALIDATION_DETAILS).map((issue) => ({
    path: validationPath(issue.path),
    code: validationCode(issue.code),
  }));
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_JSON_BODY_BYTES
  ) {
    throw new ApiError("REQUEST_TOO_LARGE");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_JSON");

  const chunks: Uint8Array[] = [];
  let size = 0;
  let bytes: Uint8Array;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > MAX_JSON_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size limit remains authoritative if the client already closed the stream.
        }
        throw new ApiError("REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }

    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_JSON");
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("INVALID_JSON");
  }
}

export async function parseJsonRequest<Schema extends ZodType>(
  request: Request,
  schema: Schema,
): Promise<output<Schema>> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }

  const result = await schema.safeParseAsync(await readJsonBody(request));
  if (!result.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      validationDetails(result.error.issues),
    );
  }
  return result.data;
}
