import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@openai/codex-sdk";
import {
  acquireLock,
  atomicWriteJson,
  classifyCodexFailure,
  checkName,
  evaluateChecks,
  MAX_REPAIRS,
  REQUIRED_CHECKS,
  runCodexTurn,
  runWithRepairs,
  unmetDependencies,
} from "./autopilot";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "autopilot-test-"));
  tempDirs.push(dir);
  return dir;
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

  it("classifies missing authentication as external", () => {
    expect(classifyCodexFailure("Not logged in; run codex login")).toBe(
      "BLOCKED_EXTERNAL",
    );
    expect(classifyCodexFailure("The request timed out")).toBe(
      "BLOCKED_EXTERNAL",
    );
  });
});
