import Database from "better-sqlite3";

export type TaskKind = "PROOF" | "REALTIME_SCAN";
export type TaskStatus =
  "PENDING" | "RUNNING" | "DONE" | "FAILED" | "BLOCKED_EXTERNAL" | "SKIPPED";

export interface Task {
  id: string;
  idempotency_key: string;
  kind: TaskKind;
  status: TaskStatus;
  due_at_ms: number;
  window_start_ms: number | null;
  window_end_ms: number | null;
  interruption_start_ms: number | null;
  interruption_end_ms: number | null;
  attempts: number;
  lease_owner: string | null;
  lease_until_ms: number | null;
  claim_generation: number;
  browser_closed_at_ms: number | null;
  result_code: string | null;
  created_at_ms: number;
  completed_at_ms: number | null;
}

export interface NewTask {
  id: string;
  idempotencyKey: string;
  kind: TaskKind;
  dueAtMs: number;
  createdAtMs: number;
  windowStartMs?: number;
  windowEndMs?: number;
}

export function openStore(path: string) {
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('PROOF', 'REALTIME_SCAN')),
      status TEXT NOT NULL CHECK (
        status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED_EXTERNAL', 'SKIPPED')
      ),
      due_at_ms INTEGER NOT NULL,
      window_start_ms INTEGER,
      window_end_ms INTEGER,
      interruption_start_ms INTEGER,
      interruption_end_ms INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      lease_owner TEXT,
      lease_until_ms INTEGER,
      claim_generation INTEGER NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
      browser_closed_at_ms INTEGER,
      result_code TEXT,
      created_at_ms INTEGER NOT NULL,
      completed_at_ms INTEGER,
      CHECK (
        (kind = 'PROOF' AND window_start_ms IS NULL AND window_end_ms IS NULL) OR
        (kind = 'REALTIME_SCAN' AND window_start_ms IS NOT NULL AND window_end_ms > window_start_ms)
      )
    ) STRICT;

    CREATE TABLE IF NOT EXISTS effects (
      idempotency_key TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
      committed_at_ms INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS runtime_state (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      last_seen_at_ms INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS runtime_events (
      id INTEGER PRIMARY KEY,
      event_type TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      interval_start_ms INTEGER,
      interval_end_ms INTEGER,
      task_id TEXT REFERENCES tasks(id),
      details_json TEXT NOT NULL CHECK (json_valid(details_json))
    ) STRICT;
  `);
  return database;
}

export function enqueueTask(
  database: ReturnType<typeof openStore>,
  input: NewTask,
) {
  const result = database
    .prepare(
      `
      INSERT OR IGNORE INTO tasks
        (id, idempotency_key, kind, status, due_at_ms, window_start_ms,
         window_end_ms, created_at_ms)
      VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)
    `,
    )
    .run(
      input.id,
      input.idempotencyKey,
      input.kind,
      input.dueAtMs,
      input.windowStartMs ?? null,
      input.windowEndMs ?? null,
      input.createdAtMs,
    );
  const task = readTask(database, input.id);
  if (!task) throw new Error("task_insert_missing");
  return { task, created: result.changes === 1 };
}

export async function createTaskFromRequest(
  request: Request,
  database: ReturnType<typeof openStore>,
  nowMs: number,
  delayMs = 0,
) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const contentType = request.headers.get("content-type") ?? "";
  let body: unknown;
  try {
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      body = { idempotencyKey: form.get("idempotencyKey") };
    } else {
      return jsonResponse({ error: "unsupported_media_type" }, 415);
    }
  } catch {
    return jsonResponse({ error: "invalid_request_body" }, 400);
  }

  const idempotencyKey =
    typeof body === "object" && body !== null && "idempotencyKey" in body
      ? body.idempotencyKey
      : undefined;
  if (
    typeof idempotencyKey !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)
  ) {
    return jsonResponse({ error: "invalid_idempotency_key" }, 400);
  }

  const { task, created } = enqueueTask(database, {
    id: idempotencyKey,
    idempotencyKey,
    kind: "PROOF",
    dueAtMs: nowMs + delayMs,
    createdAtMs: nowMs,
  });
  return jsonResponse(
    { taskId: task.id, status: task.status, created },
    created ? 202 : 200,
  );
}

export function readTask(database: ReturnType<typeof openStore>, id: string) {
  return database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    Task | undefined;
}

export function claimNextTask(
  database: ReturnType<typeof openStore>,
  workerId: string,
  nowMs: number,
  leaseDurationMs: number,
) {
  const claim = database.transaction(() => {
    const task = database
      .prepare(
        `
        SELECT * FROM tasks
        WHERE kind = 'PROOF'
          AND (
            (status = 'PENDING' AND due_at_ms <= ?) OR
            (status = 'RUNNING' AND lease_until_ms <= ?)
          )
        ORDER BY created_at_ms, id
        LIMIT 1
      `,
      )
      .get(nowMs, nowMs) as Task | undefined;
    if (!task) return undefined;

    const claimGeneration = task.claim_generation + 1;
    const eventType =
      task.status === "RUNNING" ? "TASK_RECLAIMED" : "TASK_CLAIMED";
    database
      .prepare(
        `
        UPDATE tasks
        SET status = 'RUNNING', attempts = attempts + 1, lease_owner = ?,
            lease_until_ms = ?, claim_generation = ?
        WHERE id = ?
      `,
      )
      .run(workerId, nowMs + leaseDurationMs, claimGeneration, task.id);
    database
      .prepare(
        `
        INSERT INTO runtime_events
          (event_type, occurred_at_ms, task_id, details_json)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(
        eventType,
        nowMs,
        task.id,
        JSON.stringify({ workerId, claimGeneration }),
      );
    return readTask(database, task.id);
  });

  return claim.immediate();
}

export function commitEffect(
  database: ReturnType<typeof openStore>,
  task: Task,
  nowMs: number,
) {
  const commit = database.transaction(() => {
    const currentLease = database
      .prepare(
        `
        SELECT 1 FROM tasks
        WHERE id = ? AND status = 'RUNNING'
          AND lease_owner = ? AND claim_generation = ?
      `,
      )
      .get(task.id, task.lease_owner, task.claim_generation);
    if (!currentLease) throw new Error("stale_worker_fence");

    const result = database
      .prepare(
        `
        INSERT OR IGNORE INTO effects (idempotency_key, task_id, committed_at_ms)
        VALUES (?, ?, ?)
      `,
      )
      .run(task.idempotency_key + ":effect", task.id, nowMs);
    return result.changes === 1;
  });
  return commit.immediate();
}

export function completeTask(
  database: ReturnType<typeof openStore>,
  task: Task,
  nowMs: number,
) {
  const complete = database.transaction(() => {
    const effect = database
      .prepare("SELECT 1 FROM effects WHERE task_id = ?")
      .get(task.id);
    if (!effect) throw new Error("effect_not_committed");

    const result = database
      .prepare(
        `
        UPDATE tasks
        SET status = 'DONE', result_code = 'COMPLETED',
            lease_owner = NULL, lease_until_ms = NULL, completed_at_ms = ?
        WHERE id = ? AND status = 'RUNNING'
          AND lease_owner = ? AND claim_generation = ?
      `,
      )
      .run(nowMs, task.id, task.lease_owner, task.claim_generation);
    if (result.changes !== 1) throw new Error("stale_worker_fence");
  });
  complete.immediate();
}

export function recordRuntimeTick(
  database: ReturnType<typeof openStore>,
  nowMs: number,
  heartbeatIntervalMs = 1_000,
) {
  const tick = database.transaction(() => {
    const previous = database
      .prepare(
        "SELECT last_seen_at_ms FROM runtime_state WHERE singleton_id = 1",
      )
      .get() as { last_seen_at_ms: number } | undefined;
    if (!previous) {
      database
        .prepare(
          `
          INSERT INTO runtime_state (singleton_id, last_seen_at_ms)
          VALUES (1, ?)
        `,
        )
        .run(nowMs);
      return 0;
    }

    const gapMs = nowMs - previous.last_seen_at_ms;
    if (gapMs > heartbeatIntervalMs * 3) {
      database
        .prepare(
          `
          INSERT INTO runtime_events
            (event_type, occurred_at_ms, interval_start_ms, interval_end_ms, details_json)
          VALUES ('PROCESS_GAP', ?, ?, ?, ?)
        `,
        )
        .run(
          nowMs,
          previous.last_seen_at_ms,
          nowMs,
          JSON.stringify({ durationMs: gapMs, classification: "OFFLINE_GAP" }),
        );
      database
        .prepare(
          `
          UPDATE tasks
          SET status = 'SKIPPED', result_code = 'MISSED_WINDOW',
              interruption_start_ms = ?, interruption_end_ms = ?
          WHERE kind = 'REALTIME_SCAN' AND status = 'PENDING'
            AND window_end_ms > ? AND window_end_ms <= ?
        `,
        )
        .run(previous.last_seen_at_ms, nowMs, previous.last_seen_at_ms, nowMs);
    }

    database
      .prepare(
        `
        UPDATE runtime_state SET last_seen_at_ms = ? WHERE singleton_id = 1
      `,
      )
      .run(nowMs);
    return gapMs;
  });

  return tick.immediate();
}

export function recordBrowserClose(
  database: ReturnType<typeof openStore>,
  taskId: string,
  nowMs: number,
) {
  const mark = database.transaction(() => {
    const result = database
      .prepare(
        `
        UPDATE tasks SET browser_closed_at_ms = ?
        WHERE id = ? AND status = 'PENDING'
      `,
      )
      .run(nowMs, taskId);
    if (result.changes !== 1) throw new Error("browser_proof_task_not_pending");
    database
      .prepare(
        `
        INSERT INTO runtime_events
          (event_type, occurred_at_ms, task_id, details_json)
        VALUES ('BROWSER_CLOSE_OBSERVED', ?, ?, ?)
      `,
      )
      .run(nowMs, taskId, JSON.stringify({ observedBy: "computer-use" }));
  });
  mark.immediate();
}

export function countEffects(
  database: ReturnType<typeof openStore>,
  taskId?: string,
) {
  const row = taskId
    ? (database
        .prepare("SELECT COUNT(*) AS count FROM effects WHERE task_id = ?")
        .get(taskId) as { count: number })
    : (database.prepare("SELECT COUNT(*) AS count FROM effects").get() as {
        count: number;
      });
  return row.count;
}

export function countTasks(database: ReturnType<typeof openStore>) {
  const row = database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
    count: number;
  };
  return row.count;
}

export function readSqliteVersion(database: ReturnType<typeof openStore>) {
  return database.prepare("SELECT sqlite_version() AS version").get() as {
    version: string;
  };
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
