import { createTaskFromRequest, openStore } from "../../../../store.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const databasePath = process.env.WORKER_POC_DB;
  if (!databasePath) {
    return new Response(
      JSON.stringify({ error: "worker_poc_database_missing" }),
      {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  const database = openStore(databasePath);
  try {
    return await createTaskFromRequest(request, database, Date.now(), 30_000);
  } finally {
    database.close();
  }
}
