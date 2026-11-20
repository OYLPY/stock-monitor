import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (command !== "dev" && command !== "start") {
  throw new Error("usage: local-app.ts <dev|start> [...next arguments]");
}

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const workerScript = fileURLToPath(new URL("./worker.ts", import.meta.url));
const next = spawn(
  process.execPath,
  [nextCli, command, ...process.argv.slice(3)],
  { stdio: "inherit" },
);
const worker =
  process.env.STOCK_MONITOR_DISABLE_WORKER === "1"
    ? null
    : spawn(process.execPath, ["--import", "tsx", workerScript], {
        stdio: "inherit",
      });

let stopping = false;
let nextClosed = false;
let workerClosed = worker === null;

function finishShutdown() {
  if (!stopping || !nextClosed || !workerClosed) return;
  const e2eDataDirectory = process.env.STOCK_MONITOR_E2E_DATA_DIR;
  if (e2eDataDirectory) {
    const temporaryDirectory = resolve(tmpdir());
    const targetDirectory = resolve(e2eDataDirectory);
    const relativeDirectory = relative(temporaryDirectory, targetDirectory);
    if (
      dirname(relativeDirectory) !== "." ||
      !basename(relativeDirectory).startsWith("stock-monitor-p06-06-e2e-")
    ) {
      throw new Error("e2e_data_directory_outside_temp_root");
    }
    rmSync(targetDirectory, { recursive: true, force: true });
  }
}

function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  if (next.exitCode === null) next.kill(signal);
  if (worker?.exitCode === null) worker.kill(signal);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

next.once("error", () => {
  process.exitCode = 1;
  stop("SIGTERM");
});
worker?.once("error", () => {
  process.exitCode = 1;
  stop("SIGTERM");
});

next.once("close", (code) => {
  nextClosed = true;
  if (!stopping) {
    process.exitCode = code ?? 1;
    stop("SIGTERM");
  }
  finishShutdown();
});
worker?.once("close", (code) => {
  workerClosed = true;
  if (!stopping && code !== 0) {
    process.exitCode = code ?? 1;
    stop("SIGTERM");
  }
  finishShutdown();
});
