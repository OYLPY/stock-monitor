import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import {
  enqueueScheduledTask,
  readTaskRunByIdempotencyKey,
} from "@/features/task-queue/queue";
import { localDateTimeAt } from "@/features/task-queue/time";
import { ApiError } from "@/lib/api/errors";
import { assertLocalRequest } from "@/lib/security/local-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FORM_BYTES = 1_024;
const marketWatchRequestSchema = z.strictObject({
  requestId: z.string().uuid(),
});

function redirect(query: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: `/tasks${query}` },
  });
}

async function readFormBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("VALIDATION_FAILED");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORM_BYTES) {
        await reader.cancel();
        throw new ApiError("REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new URLSearchParams(new TextDecoder().decode(body));
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
      throw new ApiError("REQUEST_TOO_LARGE");
    }
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    ) {
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
    }

    const form = await readFormBody(request);
    if (
      [...form.keys()].some((key) => key !== "requestId") ||
      form.getAll("requestId").length !== 1
    ) {
      throw new ApiError("VALIDATION_FAILED");
    }
    const input = marketWatchRequestSchema.safeParse({
      requestId: form.get("requestId"),
    });
    if (!input.success) throw new ApiError("VALIDATION_FAILED");

    const nowMs = Date.now();
    const database = await openDatabase(getLocalDatabasePath());
    try {
      const idempotencyKey = `market-watch:${input.data.requestId}`;
      const existing = readTaskRunByIdempotencyKey(database, idempotencyKey);
      let taskId = existing?.id ?? null;
      if (taskId === null) {
        try {
          taskId = enqueueScheduledTask(database, {
            idempotencyKey,
            runType: "MARKET_WATCH",
            input: {},
            timeZone: "Asia/Tokyo",
            scheduledLocalAt: localDateTimeAt(nowMs, "Asia/Tokyo"),
            timeoutMs: 60_000,
            createdAtMs: nowMs,
          }).task.id;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "idempotency_key_reused"
          ) {
            throw error;
          }
          taskId =
            readTaskRunByIdempotencyKey(database, idempotencyKey)?.id ?? null;
          if (taskId === null) throw error;
        }
      }
      return redirect(`?marketWatch=${encodeURIComponent(taskId)}`);
    } finally {
      database.client.close();
    }
  } catch {
    return redirect("?marketWatch=error");
  }
}
