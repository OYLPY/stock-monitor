import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@openai/codex-sdk";
import {
  acquireLock,
  addCommandStep,
  atomicWriteJson,
  classifyCodexFailure,
  checkName,
  evaluateChecks,
  main,
  MAX_REPAIRS,
  REQUIRED_CHECKS,
  runCodexTurn,
  runWithRepairs,
  unmetDependencies,
} from "./autopilot";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "autopilot-test-"));
  tempDirs.push(dir);
  return dir;
}

function taskState(status: "DONE" | "RUNNING") {
  const done = status === "DONE";
  return {
    schemaVersion: 1,
    tasks: {
      "P00-01": {
        status,
        attempts: 1,
        repairAttempts: 0,
        runId: done ? null : "interrupted-run",
        startedAt: done ? null : "2026-11-15T06:00:00.000Z",
        updatedAt: "2026-11-15T06:00:00.000Z",
        completedAt: done ? "2026-11-15T06:00:00.000Z" : null,
        exitCode: done ? 0 : null,
        reason: null,
      },
    },
  };
}

async function autopilotRoot(state: unknown) {
  const root = await tempDir();
  await mkdir(join(root, "docs/backlog"), { recursive: true });
  await mkdir(join(root, "harness/state"), { recursive: true });
  await mkdir(join(root, "harness/logs"), { recursive: true });
  await writeFile(
    join(root, "docs/ISSUE_INDEX.md"),
    "[P00-01 — offline fixture](https://github.com/OYLPY/stock-monitor/issues/15)",
  );
  await writeFile(
    join(root, "docs/backlog/part-00-06.json"),
    JSON.stringify({
      phases: [
        {
          id: "P00",
          tasks: [
            {
              id: "P00-01",
              title: "Offline fixture task",
              scope: "Exercise local recovery only; no market data.",
              deliverables: "A local task record",
              acceptance: "Record actual runner state and exit code.",
              depends: [],
            },
          ],
        },
      ],
    }),
  );
  await writeFile(
    join(root, "docs/backlog/part-07-13.json"),
    JSON.stringify({ phases: [] }),
  );
  await writeFile(
    join(root, "harness/tasks.json"),
    typeof state === "string" ? state : JSON.stringify(state),
  );
  return root;
}

async function executionRecord(root: string) {
  const [file] = await readdir(join(root, "harness/logs"));
  if (!file) throw new Error("Expected one execution record.");
  return JSON.parse(await readFile(join(root, "harness/logs", file), "utf8"));
}

describe("autopilot state and run controls", () => {
  it("blocks tasks until every dependency is DONE", () => {
    const task = { depends: ["P00-01", "P00-02"] };
    expect(unmetDependencies(task, { "P00-01": { status: "DONE" } })).toEqual([
      "P00-02",
    ]);
  });

  it("requires a real successful exit code for every quality check", () => {
    const commands = REQUIRED_CHECKS.map((name) => ({
      command: `pnpm ${name}`,
      exitCode: name === "test" ? null : 0,
      status: "completed",
    }));
    const report = evaluateChecks(commands);
    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === "test")?.result).toBe(
      "failed",
    );
  });

  it("counts only standalone pnpm quality checks", () => {
    expect(checkName("pnpm test")).toBe("test");
    expect(checkName("pnpm test && pnpm build")).toBeNull();
    expect(checkName("echo pnpm test")).toBeNull();
  });

  it("caps repair turns at three", async () => {
    let turns = 0;
    const result = await runWithRepairs(
      async () => {
        turns += 1;
        return {
          outcome: "completed",
          durationMs: 0,
          usage: null,
          commands: REQUIRED_CHECKS.map((name) => ({
            command: `pnpm ${name}`,
            exitCode: name === "test" ? 1 : 0,
            status: "completed",
          })),
        };
      },
      async () => undefined,
    );
    expect(turns).toBe(MAX_REPAIRS + 1);
    expect(result.status).toBe("FAILED");
    expect(result.repairAttempts).toBe(MAX_REPAIRS);
  });

  it("aborts a Codex turn at its subtask timeout", async () => {
    const thread: Pick<Thread, "runStreamed"> = {
      runStreamed: async (_input, options) => ({
        events: (async function* () {
          await new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        })(),
      }),
    };
    const result = await runCodexTurn(thread, "task", 5, async () => undefined);
    expect(result.outcome).toBe("timed_out");
  });

  it("blocks externally when the configured account model is unsupported", async () => {
    const thread: Pick<Thread, "runStreamed"> = {
      runStreamed: async () => ({
        events: (async function* () {
          yield {
            type: "turn.failed",
            error: {
              message:
                "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.",
            },
          } as const;
        })(),
      }),
    };

    const turn = await runCodexTurn(
      thread,
      "task",
      1000,
      async () => undefined,
    );
    const result = await runWithRepairs(
      async () => turn,
      async () => undefined,
    );

    expect(turn.outcome).toBe("blocked_external");
    expect(turn.reason).toBe("BLOCKED_EXTERNAL");
    expect(result.status).toBe("BLOCKED_EXTERNAL");
    expect(result.validation.passed).toBe(false);
  });

  it("completes an explicitly labeled offline SDK event fixture", async () => {
    const usage = {
      input_tokens: 100,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 20,
      reasoning_output_tokens: 0,
    };
    const thread: Pick<Thread, "runStreamed"> = {
      runStreamed: async () => ({
        events: (async function* () {
          for (const [index, name] of REQUIRED_CHECKS.entries()) {
            const id = `fixture-${index}`;
            const command = `pnpm ${name}`;
            yield {
              type: "item.started",
              item: {
                id,
                type: "command_execution",
                command,
                aggregated_output: "OFFLINE_FIXTURE_ONLY",
                status: "in_progress",
              },
            } as const;
            yield {
              type: "item.completed",
              item: {
                id,
                type: "command_execution",
                command,
                aggregated_output: "OFFLINE_FIXTURE_ONLY",
                exit_code: 0,
                status: "completed",
              },
            } as const;
          }
          yield { type: "turn.completed", usage } as const;
        })(),
      }),
    };

    const turn = await runCodexTurn(
      thread,
      "Fixture task: no network and no market data.",
      1000,
      async () => undefined,
    );
    const result = await runWithRepairs(
      async () => turn,
      async () => undefined,
    );
    const execution = { steps: [] as Array<Record<string, unknown>> };
    turn.commands.forEach((command) => addCommandStep(execution, command, 0));

    expect(result.status).toBe("DONE");
    expect(result.validation.passed).toBe(true);
    expect(turn.commands).toHaveLength(REQUIRED_CHECKS.length);
    expect(
      turn.commands.every(
        (command) => command.exitCode === 0 && command.durationMs !== undefined,
      ),
    ).toBe(true);
    expect(execution.steps).toHaveLength(REQUIRED_CHECKS.length);
    expect(
      execution.steps.every(
        (step) => step.exitCode === 0 && typeof step.durationMs === "number",
      ),
    ).toBe(true);
    expect(execution.steps[0]).toMatchObject({
      kind: "agent_command",
      turn: 0,
      check: "format:check",
      status: "completed",
      exitCode: 0,
      durationMs: expect.any(Number),
    });
  });

  it("records Codex token usage for later context calibration", async () => {
    const usage = {
      input_tokens: 1200,
      cached_input_tokens: 200,
      cache_write_input_tokens: 50,
      output_tokens: 80,
      reasoning_output_tokens: 25,
    };
    const thread: Pick<Thread, "runStreamed"> = {
      runStreamed: async () => ({
        events: (async function* () {
          yield { type: "turn.completed", usage } as const;
        })(),
      }),
    };

    const result = await runCodexTurn(
      thread,
      "task",
      1000,
      async () => undefined,
    );

    expect(result.usage).toEqual(usage);
  });

  it("replaces JSON state atomically", async () => {
    const path = join(await tempDir(), "state.json");
    await atomicWriteJson(path, { version: 1 });
    await atomicWriteJson(path, { version: 2 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 2 });
  });

  it("rejects a concurrent writer and releases its lock", async () => {
    const path = join(await tempDir(), "autopilot.lock");
    const first = await acquireLock(path, "first");
    await expect(acquireLock(path, "second")).rejects.toThrow(
      "Another autopilot process",
    );
    await first.release();
    const second = await acquireLock(path, "second");
    await second.release();
  });

  it("recovers a lock whose owner process has exited", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    await once(child, "exit");
    if (child.pid === undefined) throw new Error("Child process has no PID.");

    const lockPath = join(await tempDir(), "autopilot.lock");
    await writeFile(
      lockPath,
      JSON.stringify({ pid: child.pid, runId: "interrupted-run" }),
    );

    const lock = await acquireLock(lockPath, "recovered-run");

    expect(lock.recoveredStaleLock).toBe(true);
    await lock.release();
    await expect(readFile(lockPath, "utf8")).rejects.toThrow();
  });

  it("skips DONE tasks without checking credentials or changing state", async () => {
    const root = await autopilotRoot(taskState("DONE"));
    const statePath = join(root, "harness/tasks.json");
    const before = await readFile(statePath, "utf8");
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const exitCode = await main(
      ["--task", "P00-01", "--model", "gpt-5.6-sol"],
      root,
    );
    const record = await executionRecord(root);

    expect(exitCode).toBe(0);
    expect(record.model).toBe("gpt-5.6-sol");
    expect(await readFile(statePath, "utf8")).toBe(before);
    expect(record.status).toBe("SKIPPED_DONE");
    expect(record.runnerExitCode).toBe(0);
    expect(record.steps).toEqual([]);
    expect(record.turns).toEqual([]);
    expect(record.contextSources).toEqual([]);
  });

  it("requires a model value when the model override is requested", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await main(["--task", "P00-01", "--model"])).toBe(2);
  });

  it("fails closed on corrupted task state and preserves the source", async () => {
    const corrupted = '{"schemaVersion":1,';
    const root = await autopilotRoot(corrupted);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const exitCode = await main(["--task", "P00-01"], root);
    const record = await executionRecord(root);

    expect(exitCode).toBe(1);
    expect(await readFile(join(root, "harness/tasks.json"), "utf8")).toBe(
      corrupted,
    );
    expect(record.status).toBe("FAILED");
    expect(record.runnerExitCode).toBe(1);
    expect(record.turns).toEqual([]);
  });

  it("reconciles an interrupted run before safely blocking on missing credentials", async () => {
    const root = await autopilotRoot(taskState("RUNNING"));
    const isolatedCodexHome = join(root, "empty-codex-home");
    await mkdir(isolatedCodexHome);
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = isolatedCodexHome;
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    let exitCode: number;
    try {
      exitCode = await main(["--task", "P00-01"], root);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
    const record = await executionRecord(root);
    const state = JSON.parse(
      await readFile(join(root, "harness/tasks.json"), "utf8"),
    );

    expect(exitCode).toBe(3);
    expect(record.recoveredTasks).toEqual(["P00-01"]);
    expect(record.status).toBe("BLOCKED_EXTERNAL");
    expect(record.turns).toEqual([]);
    expect(state.tasks["P00-01"].status).toBe("BLOCKED_EXTERNAL");
  });

  it("classifies missing authentication as external", () => {
    expect(classifyCodexFailure("Not logged in; run codex login")).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(classifyCodexFailure("The request timed out")).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(
      classifyCodexFailure(
        "The 'gpt-6-luna' model is not supported with this ChatGPT account.",
      ),
    ).toBe("BLOCKED_EXTERNAL");
    expect(classifyCodexFailure('{"code":"model_not_found"}')).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(classifyCodexFailure("Unexpected internal error")).toBe("FAILED");
  });
});
