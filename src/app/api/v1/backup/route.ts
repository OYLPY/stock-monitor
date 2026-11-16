import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { ApiError, errorResponse, successResponse } from "@/lib/api/errors";
import { assertLocalRequest } from "@/lib/security/local-request";
import { backupDatabase } from "@/db/backup";
import { getLocalDatabasePath, openDatabase } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);

    const databasePath = getLocalDatabasePath();
    const database = await openDatabase(databasePath);
    database.client.close();

    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const backupDirectory = join(
      dirname(databasePath),
      "backups",
      `stock-monitor-${timestamp}-${randomUUID()}`,
    );

    return successResponse(await backupDatabase(databasePath, backupDirectory));
  } catch (error) {
    return errorResponse(
      error instanceof ApiError ? error : new ApiError("BACKUP_FAILED"),
    );
  }
}
