import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import { cancelTaskRun } from "@/features/task-queue/queue";
import { ApiError, errorResponse, successResponse } from "@/lib/api/errors";
import { assertLocalRequest } from "@/lib/security/local-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalRequest(request);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw new ApiError("VALIDATION_FAILED");
    }

    const database = await openDatabase(getLocalDatabasePath());
    try {
      return successResponse({ outcome: cancelTaskRun(database, id) });
    } finally {
      database.client.close();
    }
  } catch (error) {
    return errorResponse(
      error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR"),
    );
  }
}
