import { z } from "zod";

import { getLocalDatabasePath, openDatabase } from "@/db";
import {
  initializeDefaultPaperAccount,
  listPaperAccountLedger,
} from "@/db/paper-account-repository";
import { ApiError, errorResponse, successResponse } from "@/lib/api/errors";
import { parseJsonRequest } from "@/lib/api/request";
import { assertLocalRequest } from "@/lib/security/local-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const initializationSchema = z.object({ confirmed: z.literal(true) }).strict();

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    if (!UUID_V4.test(request.headers.get("idempotency-key") ?? "")) {
      throw new ApiError("VALIDATION_FAILED");
    }
    await parseJsonRequest(request, initializationSchema);

    const database = await openDatabase(getLocalDatabasePath());
    let opened = false;
    try {
      if (!listPaperAccountLedger(database)) {
        try {
          initializeDefaultPaperAccount(database);
          opened = true;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "paper_account_already_initialized" ||
            !listPaperAccountLedger(database)
          ) {
            throw error;
          }
        }
      }
      return successResponse({ state: "INITIALIZED" }, opened ? 201 : 200);
    } finally {
      database.client.close();
    }
  } catch (error) {
    return errorResponse(
      error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR"),
    );
  }
}
