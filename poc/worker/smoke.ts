import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimNextTask,
  commitEffect,
  completeTask,
  countEffects,
  countTasks,
  createTaskFromRequest,
  enqueueTask,
  openStore,
  readSqliteVersion,
  readTask,
  recordRuntimeTick,
} from "./store.ts";

const workerScript = fileURLToPath(new URL("./worker.ts", import.meta.url));
const databaseScenarios = [
  "before_claim",
  "after_claim",
  "after_effect_commit",
  "after_final_commit",
] as const;

function runWorkerOnce(
  databasePath: string,
  nowMs: number,
  leaseDurationMs: number,
) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      workerScript,
      "once",
      databasePath,
      String(nowMs),
      String(leaseDurationMs),
      "",
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function terminateAtCheckpoint(
  databasePath: string,
  nowMs: number,
  leaseDurationMs: number,
  checkpoint: (typeof databaseScenarios)[number],
) {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      workerScript,
      "once",
      databasePath,
      String(nowMs),
      String(leaseDurationMs),
      checkpoint,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const expectedEvent =
    checkpoint === "before_claim"
      ? "ready_before_claim"
      : checkpoint === "after_claim"
        ? "claim_committed"
        : checkpoint === "after_effect_commit"
          ? "effect_committed"
          : "done_committed";

  return new Promise<{
    event: string;
    exitCode: number | null;
    signal: string | null;
    killSent: boolean;
  }>((resolvePromise, rejectPromise) => {
    const lines = createInterface({ input: child.stdout });
    let checkpointObserved = false;
    let settled = false;
    let killSent = false;
    const timeout = setTimeout(() => {
      child.kill();
      settled = true;
      rejectPromise(new Error("worker_checkpoint_timeout:" + checkpoint));
    }, 10_000);

    lines.on("line", (line) => {
      const event = JSON.parse(line) as { event?: string };
      if (event.event !== expectedEvent || checkpointObserved) return;
      checkpointObserved = true;
      killSent = child.kill();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (!checkpointObserved) {
        rejectPromise(
          new Error("worker_exited_before_checkpoint:" + checkpoint),
        );
        return;
      }
      resolvePromise({ event: expectedEvent, exitCode, signal, killSent });
    });
  });
}

async function checkApiAndIdempotency(databasePath: string) {
  const database = openStore(databasePath);
  try {
    const request = () =>
      new Request("http://127.0.0.1/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "api-proof" }),
      });
    const created = await createTaskFromRequest(
      request(),
      database,
      1_000,
      5_000,
    );
    const repeated = await createTaskFromRequest(
      request(),
      database,
      1_001,
      5_000,
    );
    const invalid = await createTaskFromRequest(
      new Request("http://127.0.0.1/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "../unsafe" }),
      }),
      database,
      1_002,
    );
    assert.equal(created.status, 202);
    assert.equal(repeated.status, 200);
    assert.equal(invalid.status, 400);
    assert.equal(countTasks(database), 1);
    return {
      created: created.status,
      repeated: repeated.status,
      invalid: invalid.status,
    };
  } finally {
    database.close();
  }
}

async function checkLeaseFencing(databasePath: string) {
  const database = openStore(databasePath);
  try {
    enqueueTask(database, {
      id: "fencing-proof",
      idempotencyKey: "fencing-proof",
      kind: "PROOF",
      dueAtMs: 100,
      createdAtMs: 100,
    });
    const staleLease = claimNextTask(database, "old-worker", 100, 10);
    const currentLease = claimNextTask(database, "new-worker", 111, 100);
    assert.ok(staleLease);
    assert.ok(currentLease);
    assert.equal(staleLease.claim_generation, 1);
    assert.equal(currentLease.claim_generation, 2);
    assert.throws(
      () => commitEffect(database, staleLease, 112),
      /stale_worker_fence/,
    );
    assert.equal(commitEffect(database, currentLease, 113), true);
    completeTask(database, currentLease, 114);
    assert.equal(readTask(database, "fencing-proof")?.status, "DONE");
    assert.equal(countEffects(database), 1);
    return { staleWorkerRejected: true, currentWorkerCompleted: true };
  } finally {
    database.close();
  }
}

async function checkMissedWindow(databasePath: string) {
  const database = openStore(databasePath);
  try {
    enqueueTask(database, {
      id: "missed-window",
      idempotencyKey: "missed-window",
      kind: "REALTIME_SCAN",
      dueAtMs: 1_500,
      windowStartMs: 1_500,
      windowEndMs: 3_000,
      createdAtMs: 1_000,
    });
    recordRuntimeTick(database, 1_000);
    const gapMs = recordRuntimeTick(database, 5_000);
    const task = readTask(database, "missed-window");
    assert.equal(gapMs, 4_000);
    assert.equal(task?.status, "SKIPPED");
    assert.equal(task?.result_code, "MISSED_WINDOW");
    assert.equal(task?.interruption_start_ms, 1_000);
    assert.equal(task?.interruption_end_ms, 5_000);
    assert.equal(countEffects(database), 0);
    return { gapMs, status: task?.status, resultCode: task?.result_code };
  } finally {
    database.close();
  }
}

async function run() {
  const directory = await mkdtemp(join(tmpdir(), "stock-monitor-p04-04-"));
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedDirectory = resolve(directory);
  assert.ok(resolvedDirectory.startsWith(resolvedTempRoot + sep));
  const scenarios: Record<string, unknown>[] = [];

  try {
    for (const [index, checkpoint] of databaseScenarios.entries()) {
      const databasePath = join(directory, checkpoint + ".sqlite");
      const database = openStore(databasePath);
      enqueueTask(database, {
        id: checkpoint,
        idempotencyKey: checkpoint,
        kind: "PROOF",
        dueAtMs: 100,
        createdAtMs: 100,
      });
      database.close();

      const killed = await terminateAtCheckpoint(
        databasePath,
        101,
        10,
        checkpoint,
      );
      const afterKill = openStore(databasePath);
      const interruptedTask = readTask(afterKill, checkpoint);
      const effectsAfterKill = countEffects(afterKill, checkpoint);
      assert.ok(interruptedTask);
      if (checkpoint === "before_claim") {
        assert.equal(interruptedTask.status, "PENDING");
        assert.equal(effectsAfterKill, 0);
      } else if (checkpoint === "after_claim") {
        assert.equal(interruptedTask.status, "RUNNING");
        assert.equal(effectsAfterKill, 0);
      } else if (checkpoint === "after_effect_commit") {
        assert.equal(interruptedTask.status, "RUNNING");
        assert.equal(effectsAfterKill, 1);
      } else {
        assert.equal(interruptedTask.status, "DONE");
        assert.equal(effectsAfterKill, 1);
      }
      const recoveryAt = (interruptedTask.lease_until_ms ?? 200) + 1 + index;
      afterKill.close();

      const recoveryRun = runWorkerOnce(databasePath, recoveryAt, 10);
      const duplicateRun = runWorkerOnce(databasePath, recoveryAt + 20, 10);
      const recovered = openStore(databasePath);
      const finalTask = readTask(recovered, checkpoint);
      assert.equal(finalTask?.status, "DONE");
      assert.equal(countEffects(recovered, checkpoint), 1);
      assert.equal(countTasks(recovered), 1);
      scenarios.push({
        checkpoint,
        terminated: true,
        interruptedStatus: interruptedTask.status,
        effectsAfterTermination: effectsAfterKill,
        finalStatus: finalTask?.status,
        effectCount: countEffects(recovered, checkpoint),
        attempts: finalTask?.attempts,
        firstRecoveryEvent: recoveryRun.at(-1)?.event,
        repeatedRunEvent: duplicateRun.at(-1)?.event,
      });
      recovered.close();
      assert.equal(killed.killSent, true);
      assert.notEqual(killed.exitCode, 0);
    }

    const api = await checkApiAndIdempotency(join(directory, "api.sqlite"));
    const fencing = await checkLeaseFencing(join(directory, "fencing.sqlite"));
    const offlineGap = await checkMissedWindow(join(directory, "gap.sqlite"));
    const metadata = openStore(join(directory, "metadata.sqlite"));
    const sqlite = readSqliteVersion(metadata).version;
    metadata.close();
    const result = {
      mode: "worker-recovery-self-check",
      outcome: "passed",
      node: process.version,
      sqlite,
      scenarios,
      api,
      fencing,
      simulatedOfflineGap: offlineGap,
      forcedProcessTermination:
        "child process terminated at persisted checkpoints",
      realSleepOrPowerLoss: "NOT_TESTED",
      realMarketData: "none",
      credentialsRead: false,
      externalRequests: 0,
    };
    const line = JSON.stringify(result);
    await appendFile(
      new URL("./actual-run-2026-11-16.jsonl", import.meta.url),
      line + "\n",
    );
    process.stdout.write(line + "\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({
      mode: "worker-recovery-self-check",
      outcome: "failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }) + "\n",
  );
  process.exitCode = 1;
});
