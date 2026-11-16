import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  countEffects,
  openStore,
  readTask,
  recordBrowserClose,
} from "./store.ts";

const workerDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(workerDirectory, "../..");
const workerScript = join(workerDirectory, "worker.ts");
const nextAppDirectory = join(workerDirectory, "next-app");
const nextCli = join(repositoryRoot, "node_modules/next/dist/bin/next");
const reportPath = join(workerDirectory, "actual-run-2026-11-16.jsonl");
const taskId = "browser-close-proof";

function isRunning(child: ChildProcess) {
  return child.exitCode === null && child.signalCode === null;
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child || !isRunning(child) || child.pid === undefined) return;
  const closed = once(child, "close").then(
    () => true,
    () => true,
  );

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
    if (!(await Promise.race([closed, delay(5_000).then(() => false)]))) {
      child.kill("SIGKILL");
    }
  }
  await Promise.race([closed, delay(5_000)]);
}

async function waitForWorkerReady(worker: ChildProcess) {
  assert.ok(worker.stdout);
  const lines = createInterface({ input: worker.stdout });
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      lines.close();
      rejectPromise(new Error("worker_ready_timeout"));
    }, 10_000);
    lines.on("line", (line) => {
      const event = JSON.parse(line) as { event?: string };
      if (event.event === "worker_ready") {
        clearTimeout(timeout);
        lines.close();
        resolvePromise();
      } else if (event.event === "worker_failed") {
        clearTimeout(timeout);
        lines.close();
        rejectPromise(new Error("worker_failed:" + line));
      }
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      lines.close();
      rejectPromise(error);
    });
    worker.once("close", (code) => {
      clearTimeout(timeout);
      lines.close();
      rejectPromise(new Error("worker_exited_before_ready:" + code));
    });
  });
}

async function allocatePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
  return port;
}

async function waitForNext(
  url: string,
  next: ChildProcess,
  getOutput: () => string,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (!isRunning(next)) {
      throw new Error("next_exited_before_ready:\n" + getOutput());
    }
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()).includes("启动持久任务"))
        return;
    } catch {
      // The dev server is still binding or compiling.
    }
    await delay(250);
  }
  throw new Error("next_ready_timeout:\n" + getOutput());
}

async function waitForBrowserClose() {
  const lines = createInterface({ input: process.stdin });
  return new Promise<void>((resolvePromise) => {
    lines.on("line", (line) => {
      if (line.trim() !== "browser-closed") return;
      lines.close();
      resolvePromise();
    });
  });
}

async function waitForCompletedTask(databasePath: string, closedAtMs: number) {
  const deadline = Date.now() + 60_000;
  const database = openStore(databasePath);
  try {
    while (Date.now() < deadline) {
      const task = readTask(database, taskId);
      if (task?.status === "DONE") {
        const heartbeat = database
          .prepare(
            "SELECT last_seen_at_ms FROM runtime_state WHERE singleton_id = 1",
          )
          .get() as { last_seen_at_ms: number } | undefined;
        assert.ok(heartbeat && heartbeat.last_seen_at_ms > closedAtMs);
        assert.ok(task.completed_at_ms && task.completed_at_ms > closedAtMs);
        assert.equal(countEffects(database, taskId), 1);
        return { task, heartbeatAtMs: heartbeat.last_seen_at_ms };
      }
      await delay(250);
    }
    throw new Error("worker_did_not_complete_after_browser_close");
  } finally {
    database.close();
  }
}

async function run() {
  const directory = await mkdtemp(
    join(tmpdir(), "stock-monitor-p04-04-browser-"),
  );
  const resolvedTempRoot = resolve(tmpdir());
  const resolvedDirectory = resolve(directory);
  assert.ok(resolvedDirectory.startsWith(resolvedTempRoot + sep));
  const databasePath = join(directory, "worker.sqlite");
  let worker: ChildProcess | undefined;
  let next: ChildProcess | undefined;
  let nextOutput = "";

  try {
    const port = await allocatePort();
    const url = `http://127.0.0.1:${port}/`;
    worker = spawn(
      process.execPath,
      ["--experimental-strip-types", workerScript, "loop", databasePath],
      { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForWorkerReady(worker);

    next = spawn(
      process.execPath,
      [
        nextCli,
        "dev",
        nextAppDirectory,
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          WORKER_POC_DB: databasePath,
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const captureNextOutput = (chunk: Buffer) => {
      nextOutput = (nextOutput + chunk.toString()).slice(-8_000);
    };
    next.stdout?.on("data", captureNextOutput);
    next.stderr?.on("data", captureNextOutput);
    await waitForNext(url, next, () => nextOutput);

    const workerPid = worker.pid;
    const nextPid = next.pid;
    assert.ok(workerPid && nextPid);
    process.stdout.write(
      JSON.stringify({ event: "browser_ready", url, workerPid, nextPid }) +
        "\n",
    );
    await waitForBrowserClose();

    await stopChild(next);
    assert.ok(!isRunning(next));
    const closedAtMs = Date.now();
    const database = openStore(databasePath);
    try {
      recordBrowserClose(database, taskId, closedAtMs);
    } finally {
      database.close();
    }
    assert.ok(isRunning(worker));

    const { task, heartbeatAtMs } = await waitForCompletedTask(
      databasePath,
      closedAtMs,
    );
    const result = {
      mode: "next-page-close-worker-proof",
      outcome: "passed",
      taskId,
      browserClosedAtMs: closedAtMs,
      workerPid,
      nextPid,
      nextServerStopped: true,
      workerAliveAfterPageAndServerClose: isRunning(worker),
      finalStatus: task.status,
      completedAtMs: task.completed_at_ms,
      heartbeatAtMs,
      effectCount: 1,
      realSleepOrPowerLoss: "NOT_TESTED",
      macOSStartup: "NOT_TESTED",
      realMarketData: "none",
      credentialsRead: false,
      externalRequests: 0,
    };
    await appendFile(reportPath, JSON.stringify(result) + "\n", "utf8");
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await stopChild(next);
    await stopChild(worker);
    await rm(resolvedDirectory, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    (error instanceof Error ? (error.stack ?? error.message) : String(error)) +
      "\n",
  );
  process.exitCode = 1;
});
