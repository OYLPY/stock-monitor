import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { listNotificationsAfter } from "@/features/alerts/alerts";
import { ApiError, errorResponse, successResponse } from "@/lib/api/errors";
import { assertLocalRequest } from "@/lib/security/local-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cursorSchema = z.strictObject({
  afterCreatedAtMs: z.string().regex(/^(0|[1-9]\d*)$/),
  afterId: z.union([z.literal(""), z.string().uuid()]),
});

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const searchParams = new URL(request.url).searchParams;
    if (
      [...searchParams.keys()].length !== 2 ||
      searchParams.getAll("afterCreatedAtMs").length !== 1 ||
      searchParams.getAll("afterId").length !== 1
    ) {
      throw new ApiError("VALIDATION_FAILED");
    }

    const parsed = cursorSchema.safeParse({
      afterCreatedAtMs: searchParams.get("afterCreatedAtMs"),
      afterId: searchParams.get("afterId"),
    });
    if (!parsed.success) throw new ApiError("VALIDATION_FAILED");

    const createdAtMs = Number(parsed.data.afterCreatedAtMs);
    if (
      !Number.isSafeInteger(createdAtMs) ||
      (createdAtMs === 0) !== (parsed.data.afterId === "")
    ) {
      throw new ApiError("VALIDATION_FAILED");
    }

    const database = await openDatabase(getLocalDatabasePath());
    try {
      return successResponse({
        notifications: listNotificationsAfter(database, {
          createdAtMs,
          id: parsed.data.afterId,
        }),
      });
    } finally {
      database.client.close();
    }
  } catch (error) {
    return errorResponse(error);
  }
}
