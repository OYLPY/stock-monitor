import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { open, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Codex } from "@openai/codex-sdk";
import type { Thread, Usage } from "@openai/codex-sdk";
import { buildPersistedContext } from "./context.ts";

export const REQUIRED_CHECKS = [
  "format:check",
  "lint",
  "typecheck",
  "test",
  "build",
] as const;
export const MAX_REPAIRS = 3;
const TASK_FILES = [
  "docs/backlog/part-00-06.json",
  "docs/backlog/part-07-13.json",
];
const STATUS_VALUES = [
  "PENDING",
  "RUNNING",
  "DONE",
  "BLOCKED",
  "BLOCKED_EXTERNAL",
  "FAILED",
] as const;

export type TaskStatus = (typeof STATUS_VALUES)[number];
export type CommandResult = {
  command: string;
  exitCode: number | null;
  status: string;
  durationMs?: number | null;
};
type TaskDefinition = {
  id: string;
  title: string;
  scope: string;
  deliverables: string;
  acceptance: string;
  depends: string[];
  issueUrl?: string;
};
type TaskStateEntry = {
  status: TaskStatus;
  attempts: number;
  repairAttempts: number;
  runId: string | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  reason: string | null;
  source?: string;
};
type TaskState = { schemaVersion: 1; tasks: Record<string, TaskStateEntry> };
type CheckResult = {
  name: (typeof REQUIRED_CHECKS)[number];
  exitCode: number | null;
  result: "passed" | "failed" | "missing";
};
type CheckReport = { passed: boolean; checks: CheckResult[] };
type CodexTurn = {
  outcome: "completed" | "failed" | "blocked_external" | "timed_out";
  commands: CommandResult[];
  durationMs: number;
  usage: Usage | null;
  reason?: string;
};
type RepairResult = {
  status: "DONE" | "FAILED" | "BLOCKED_EXTERNAL";
  repairAttempts: number;
  validation: CheckReport;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableDate(value: unknown) {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}

export async function atomicWriteJson(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${randomUUID()}`;
  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(tempPath, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function acquireLock(lockPath: string, runId: string) {
  await mkdir(dirname(lockPath), { recursive: true });
  let recoveredStaleLock = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            runId,
            startedAt: new Date().toISOString(),
          }),
          "utf8",
        );
        await handle.sync();
      } catch (error) {
        await handle.close();
        await rm(lockPath, { force: true });
        throw error;
      }
      await handle.close();
      return {
        recoveredStaleLock,
        release: async () => {
          try {
            const current = JSON.parse(await readFile(lockPath, "utf8")) as {
              runId?: string;
            };
            if (current.runId === runId) await rm(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: number };
      try {
        owner = JSON.parse(await readFile(lockPath, "utf8")) as {
          pid?: number;
        };
      } catch {
        throw new Error(
          "An unreadable autopilot lock exists; refusing to replace it.",
        );
      }
      // shortcut: PID reuse can keep a stale lock alive; upgrade to process-start identity if observed.
      if (
        typeof owner.pid !== "number" ||
        !Number.isInteger(owner.pid) ||
        processIsAlive(owner.pid)
      ) {
        throw new Error("Another autopilot process owns the lock.");
      }
      const stalePath = `${lockPath}.stale-${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw renameError;
      }
      await rm(stalePath, { force: true });
      recoveredStaleLock = true;
    }
  }
  throw new Error("Unable to acquire the autopilot lock.");
}

export function unmetDependencies(
  task: Pick<TaskDefinition, "depends">,
  tasks: Record<string, { status: TaskStatus }>,
) {
  return task.depends.filter((id) => tasks[id]?.status !== "DONE");
}

export function checkName(
  command: string,
): (typeof REQUIRED_CHECKS)[number] | null {
  if (/&&|\|\||;/.test(command)) return null;
  const match = command
    .trim()
    .match(
      /^pnpm(?:\.cmd)?\s+(?:run\s+)?(format:check|lint|typecheck|test|build)\s*$/i,
    );
  return (
    (match?.[1]?.toLowerCase() as
      (typeof REQUIRED_CHECKS)[number] | undefined) ?? null
  );
}

export function evaluateChecks(commands: CommandResult[]): CheckReport {
  const latest = new Map<string, CommandResult>();
  for (const command of commands) {
    const name = checkName(command.command);
    if (name) latest.set(name, command);
  }
  const checks = REQUIRED_CHECKS.map((name) => {
    const command = latest.get(name);
    return {
      name,
      exitCode: command?.exitCode ?? null,
      result: !command
        ? "missing"
        : command.exitCode === 0
          ? "passed"
          : "failed",
    } satisfies CheckResult;
  });
  return { passed: checks.every((check) => check.result === "passed"), checks };
}

export function classifyCodexFailure(message: string) {
  return /not logged in|authentication required|unauthenticated|invalid api key|missing credentials|login required|model_not_found|model.{0,40}(?:not supported|not available|unsupported)|rate limit|quota|usage limit|billing|connection|network|offline|fetch failed|timed out|timeout|temporarily unavailable|service unavailable|\b50[023]\b|\b40[13]\b/i.test(
    message,
  )
    ? "BLOCKED_EXTERNAL"
    : "FAILED";
}

export async function runWithRepairs(
  runTurn: (repairAttempt: number, previous: CheckReport) => Promise<CodexTurn>,
  onTurn: (
    repairAttempt: number,
    turn: CodexTurn,
    validation: CheckReport,
  ) => Promise<void>,
): Promise<RepairResult> {
  const commands: CommandResult[] = [];
  let validation = evaluateChecks(commands);

  for (
    let repairAttempt = 0;
    repairAttempt <= MAX_REPAIRS;
    repairAttempt += 1
  ) {
    const turn = await runTurn(repairAttempt, validation);
    commands.push(...turn.commands);
    validation = evaluateChecks(commands);
    await onTurn(repairAttempt, turn, validation);
    if (turn.outcome !== "completed") {
      return {
        status:
          turn.outcome === "blocked_external" ? "BLOCKED_EXTERNAL" : "FAILED",
        repairAttempts: repairAttempt,
        validation,
        reason: turn.reason ?? turn.outcome,
      };
    }
    if (validation.passed)
      return { status: "DONE", repairAttempts: repairAttempt, validation };
  }

  return {
    status: "FAILED",
    repairAttempts: MAX_REPAIRS,
    validation,
    reason: "Quality checks still fail after three repair attempts.",
  };
}

function validateState(value: unknown): asserts value is TaskState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.tasks)) {
    throw new Error("The autopilot task state has an unsupported schema.");
  }
  for (const [id, entry] of Object.entries(value.tasks)) {
    if (
      !/^P\d{2}-\d{2}$/.test(id) ||
      !isRecord(entry) ||
      !STATUS_VALUES.includes(entry.status as TaskStatus) ||
      !Number.isInteger(entry.attempts) ||
      Number(entry.attempts) < 0 ||
      !Number.isInteger(entry.repairAttempts) ||
      Number(entry.repairAttempts) < 0 ||
      Number(entry.repairAttempts) > MAX_REPAIRS ||
      !(entry.runId === null || typeof entry.runId === "string") ||
      !isNullableDate(entry.startedAt) ||
      !isNullableDate(entry.completedAt) ||
      typeof entry.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.updatedAt)) ||
      !(entry.exitCode === null || Number.isInteger(entry.exitCode)) ||
      !(entry.reason === null || typeof entry.reason === "string") ||
      (entry.source !== undefined && typeof entry.source !== "string")
    ) {
      throw new Error(`The autopilot task state is invalid for ${id}.`);
    }
  }
}

async function readTaskState(filePath: string): Promise<TaskState> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    validateState(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, tasks: {} };
    }
    throw error;
  }
}

async function readTaskCatalog(root: string) {
  const issueLinks = new Map<string, string>();
  const index = await readFile(join(root, "docs/ISSUE_INDEX.md"), "utf8");
  for (const match of index.matchAll(
    /\[(P\d{2}-\d{2})[^\]]*\]\((https:\/\/github\.com\/[^)]+\/issues\/\d+)\)/g,
  )) {
    const [, taskId, issueUrl] = match;
    if (taskId && issueUrl) issueLinks.set(taskId, issueUrl);
  }

  const catalog = new Map<string, TaskDefinition>();
  for (const file of TASK_FILES) {
    const data: unknown = JSON.parse(await readFile(join(root, file), "utf8"));
    if (!isRecord(data) || !Array.isArray(data.phases)) {
      throw new Error(`The backlog file ${file} has an invalid shape.`);
    }
    for (const phase of data.phases) {
      if (!isRecord(phase) || !Array.isArray(phase.tasks)) continue;
      for (const task of phase.tasks) {
        if (
          !isRecord(task) ||
          typeof task.id !== "string" ||
          typeof task.title !== "string" ||
          typeof task.scope !== "string" ||
          typeof task.deliverables !== "string" ||
          typeof task.acceptance !== "string" ||
          !Array.isArray(task.depends) ||
          !task.depends.every((id) => typeof id === "string")
        ) {
          throw new Error(`The backlog file ${file} contains an invalid task.`);
        }
        catalog.set(task.id, {
          id: task.id,
          title: task.title,
          scope: task.scope,
          deliverables: task.deliverables,
          acceptance: task.acceptance,
          depends: task.depends,
          issueUrl: issueLinks.get(task.id),
        });
      }
    }
  }
  return catalog;
}

function minimalEnvironment(): Record<string, string> {
  const allowed = new Set([
    "path",
    "systemroot",
    "windir",
    "comspec",
    "pathext",
    "temp",
    "tmp",
    "userprofile",
    "appdata",
    "localappdata",
    "home",
  ]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toLowerCase())) env[key] = value;
  }
  env.CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
  return env;
}

function codexCliScript() {
  const sdkEntry = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
  const sdkRequire = createRequire(sdkEntry);
  const packageJson = sdkRequire.resolve("@openai/codex/package.json");
  const metadata = JSON.parse(readFileSync(packageJson, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const binary =
    typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.codex;
  if (!binary)
    throw new Error(
      "The installed Codex SDK does not include its CLI entrypoint.",
    );
  return resolve(dirname(packageJson), binary);
}

function runLocalCli(script: string, cwd: string, env: Record<string, string>) {
  const startedAt = Date.now();
  return new Promise<{
    exitCode: number | null;
    output: string;
    timedOut: boolean;
    spawnError: boolean;
    durationMs: number;
  }>((resolveResult) => {
    execFile(
      process.execPath,
      [script, "login", "status"],
      {
        cwd,
        env: { ...env, NODE_ENV: process.env.NODE_ENV ?? "production" },
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = error && "code" in error ? error.code : undefined;
        resolveResult({
          exitCode: typeof code === "number" ? code : error ? null : 0,
          output: `${stdout}\n${stderr}`.slice(-8192),
          timedOut: code === "ETIMEDOUT",
          spawnError: Boolean(
            error && code !== "ETIMEDOUT" && typeof code !== "number",
          ),
          durationMs: Date.now() - startedAt,
        });
      },
    );
  });
}

function classifyLogin(result: {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  spawnError: boolean;
}) {
  const output = result.output.toLowerCase();
  if (
    /not logged in|not authenticated|no credentials|login required/.test(output)
  )
    return "missing";
  if (
    !result.timedOut &&
    !result.spawnError &&
    result.exitCode === 0 &&
    /logged in|authenticated/.test(output)
  ) {
    return "authenticated";
  }
  return "unknown";
}

function permissionOverrides() {
  return [
    'permissions.autopilot.filesystem={":minimal"="read",":workspace_roots"={"."="write",".git"="read","docs/backlog"="read","AGENTS.md"="read","harness/tasks.json"="read","harness/state/autopilot.lock"="deny","harness/logs"="read",".env"="deny",".env.*"="deny","**/.env"="deny","**/.env.*"="deny"}}',
    "permissions.autopilot.network.enabled=false",
  ];
}

function taskPrompt(task: TaskDefinition, persistedContext: string) {
  return [
    `Implement the controlled work item ${task.id}: ${task.title}.`,
    task.issueUrl ? `Issue: ${task.issueUrl}` : "",
    `Scope: ${task.scope}`,
    `Deliverables: ${task.deliverables}`,
    `Acceptance: ${task.acceptance}`,
    `Dependencies: ${task.depends.length ? task.depends.join(", ") : "none"}`,
    "Reconstructed context and safety rules:",
    persistedContext,
    "Follow AGENTS.md and existing project patterns. Change only what this task needs.",
    "Do not access live market/news data, make real trades, widen permissions, use external network from commands, commit, push, merge, or change GitHub Issues.",
    `After implementation, run each command separately and capture its actual exit code: ${REQUIRED_CHECKS.map((check) => `pnpm ${check}`).join(", ")}.`,
    "Do not combine checks. Do not claim a check passed unless you executed it.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function repairPrompt(task: TaskDefinition, previous: CheckReport) {
  const failures = previous.checks
    .filter((check) => check.result !== "passed")
    .map(
      (check) =>
        `pnpm ${check.name}: ${check.result}, exit code ${check.exitCode ?? "not recorded"}`,
    );
  return [
    `Continue ${task.id} and repair the current implementation.`,
    `Checks needing repair: ${failures.join("; ")}. Inspect the repository and diagnose them locally.`,
    "Make only changes needed for this work item. Keep all permissions and safety limits unchanged.",
    `Run all checks separately after the repair: ${REQUIRED_CHECKS.map((check) => `pnpm ${check}`).join(", ")}.`,
    "Do not combine checks or report results you did not execute.",
  ].join("\n\n");
}

export async function runCodexTurn(
  thread: Pick<Thread, "runStreamed">,
  prompt: string,
  timeoutMs: number,
  onCommand: (command: CommandResult) => Promise<void>,
): Promise<CodexTurn> {
  const startedAt = Date.now();
  const commands: CommandResult[] = [];
  const commandStarts = new Map<string, number>();
  const signal = AbortSignal.timeout(timeoutMs);
  let completed = false;
  let failure = "";
  let usage: Usage | null = null;
  try {
    const { events } = await thread.runStreamed(prompt, { signal });
    for await (const event of events) {
      if (
        event.type === "item.started" &&
        event.item.type === "command_execution"
      ) {
        commandStarts.set(event.item.id, Date.now());
      }
      if (
        event.type === "item.completed" &&
        event.item.type === "command_execution"
      ) {
        const command = {
          command: event.item.command,
          exitCode: event.item.exit_code ?? null,
          status: event.item.status,
          durationMs:
            Date.now() - (commandStarts.get(event.item.id) ?? startedAt),
        };
        commands.push(command);
        await onCommand(command);
      } else if (event.type === "turn.completed") {
        completed = true;
        usage = event.usage;
      } else if (event.type === "turn.failed" || event.type === "error") {
        failure =
          event.type === "turn.failed" ? event.error.message : event.message;
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "Codex SDK error";
  }
  const durationMs = Date.now() - startedAt;
  if (completed) return { outcome: "completed", commands, durationMs, usage };
  if (signal.aborted)
    return {
      outcome: "timed_out",
      commands,
      durationMs,
      usage,
      reason: "Codex turn timed out.",
    };
  const category = classifyCodexFailure(failure);
  return {
    outcome: category === "BLOCKED_EXTERNAL" ? "blocked_external" : "failed",
    commands,
    durationMs,
    usage,
    reason: category === "BLOCKED_EXTERNAL" ? category : "Codex turn failed.",
  };
}

function taskEntry(
  previous: TaskStateEntry | undefined,
  patch: Partial<TaskStateEntry> & Pick<TaskStateEntry, "status">,
): TaskStateEntry {
  if (previous?.status === "DONE" && patch.status !== "DONE") {
    throw new Error("A completed task cannot move back to an active state.");
  }
  const source = patch.source ?? previous?.source;
  return {
    status: patch.status,
    attempts: patch.attempts ?? previous?.attempts ?? 0,
    repairAttempts: patch.repairAttempts ?? previous?.repairAttempts ?? 0,
    runId: patch.runId !== undefined ? patch.runId : (previous?.runId ?? null),
    startedAt:
      patch.startedAt !== undefined
        ? patch.startedAt
        : (previous?.startedAt ?? null),
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
    completedAt:
      patch.completedAt !== undefined
        ? patch.completedAt
        : (previous?.completedAt ?? null),
    exitCode:
      patch.exitCode !== undefined
        ? patch.exitCode
        : (previous?.exitCode ?? null),
    reason:
      patch.reason !== undefined ? patch.reason : (previous?.reason ?? null),
    ...(source ? { source } : {}),
  };
}

function reconcileInterruptedRuns(state: TaskState) {
  const recovered: string[] = [];
  for (const [id, entry] of Object.entries(state.tasks)) {
    if (entry.status === "RUNNING") {
      state.tasks[id] = taskEntry(entry, {
        status: "PENDING",
        runId: null,
        exitCode: null,
        reason:
          "Recovered an interrupted run; the task must inspect current workspace state.",
      });
      recovered.push(id);
    }
  }
  return recovered;
}

export function addCommandStep(
  record: { steps: Array<Record<string, unknown>> },
  command: CommandResult,
  turn: number,
) {
  record.steps.push({
    kind: "agent_command",
    turn,
    check: checkName(command.command) ?? "unclassified",
    status: command.status,
    exitCode: command.exitCode,
    durationMs: command.durationMs ?? null,
  });
}

type ExecutionRecord = {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  runnerExitCode: number | null;
  repairAttempts: number;
  recoveredTasks: string[];
  steps: Array<Record<string, unknown>>;
  turns: Array<{
    number: number;
    outcome: CodexTurn["outcome"];
    durationMs: number;
    usage: Usage | null;
    reason?: string;
  }>;
  contextSources: string[];
  validation?: CheckReport;
  reason?: string;
};

function usage() {
  return "Usage: pnpm autopilot --task P00-03";
}

export async function main(args: string[], root = process.cwd()) {
  const [option, taskId] = args;
  if (
    args.length !== 2 ||
    option !== "--task" ||
    typeof taskId !== "string" ||
    !/^P\d{2}-\d{2}$/.test(taskId)
  ) {
    console.error(usage());
    return 2;
  }
  const catalog = await readTaskCatalog(root);
  const task = catalog.get(taskId);
  if (!task) {
    console.error(`Unknown task: ${taskId}`);
    return 2;
  }

  const runId = randomUUID();
  const statePath = join(root, "harness/tasks.json");
  const lockPath = join(root, "harness/state/autopilot.lock");
  const logPath = join(root, "harness/logs", `${taskId}-${runId}.json`);
  let lock: Awaited<ReturnType<typeof acquireLock>>;
  try {
    lock = await acquireLock(lockPath, runId);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Could not acquire the autopilot lock.",
    );
    return 2;
  }
  const record: ExecutionRecord = {
    schemaVersion: 1,
    runId,
    taskId,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    runnerExitCode: null,
    repairAttempts: 0,
    recoveredTasks: [],
    turns: [],
    contextSources: [],
    steps: lock.recoveredStaleLock
      ? [
          {
            kind: "lock_recovery",
            status: "recovered_stale_lock",
            exitCode: null,
          },
        ]
      : [],
  };
  const flushRecord = () => atomicWriteJson(logPath, record);
  let state: TaskState | null = null;
  let resultCode = 1;

  try {
    const taskState = await readTaskState(statePath);
    state = taskState;
    record.recoveredTasks = reconcileInterruptedRuns(taskState);
    if (record.recoveredTasks.length)
      await atomicWriteJson(statePath, taskState);

    const previous = taskState.tasks[task.id];
    if (previous?.status === "DONE") {
      record.status = "SKIPPED_DONE";
      resultCode = 0;
    } else {
      const blocked = unmetDependencies(task, taskState.tasks);
      if (blocked.length) {
        const reason = `Dependencies are not DONE: ${blocked.join(", ")}`;
        taskState.tasks[task.id] = taskEntry(previous, {
          status: "BLOCKED",
          reason,
        });
        record.status = "BLOCKED";
        record.reason = reason;
        resultCode = 2;
        await atomicWriteJson(statePath, taskState);
      } else {
        taskState.tasks[task.id] = taskEntry(previous, {
          status: "RUNNING",
          attempts: (previous?.attempts ?? 0) + 1,
          repairAttempts: 0,
          runId,
          startedAt: record.startedAt,
          completedAt: null,
          exitCode: null,
          reason: null,
        });
        await atomicWriteJson(statePath, taskState);
        await flushRecord();

        const env = {
          ...minimalEnvironment(),
          NODE_ENV: process.env.NODE_ENV ?? "production",
        };
        const authCheck = await runLocalCli(codexCliScript(), root, env);
        const auth = classifyLogin(authCheck);
        record.steps.push({
          kind: "codex_login_status",
          status: auth,
          exitCode: authCheck.exitCode,
          durationMs: authCheck.durationMs,
        });
        await flushRecord();

        if (auth !== "authenticated") {
          record.status = "BLOCKED_EXTERNAL";
          record.reason =
            auth === "missing"
              ? "Codex CLI is not logged in."
              : "Codex login status could not be verified.";
          taskState.tasks[task.id] = taskEntry(taskState.tasks[task.id], {
            status: "BLOCKED_EXTERNAL",
            runId,
            exitCode: null,
            reason: record.reason,
          });
          resultCode = 3;
        } else {
          const persistedContext = await buildPersistedContext(root, task);
          record.contextSources = persistedContext.sources;
          await flushRecord();
          const codex = new Codex({
            env,
            config: { default_permissions: "autopilot" },
            configOverrides: permissionOverrides(),
          });
          const thread = codex.startThread({
            workingDirectory: root,
            approvalPolicy: "never",
            webSearchMode: "disabled",
          });
          const deadline = Date.now() + 30 * 60 * 1000;
          const executed = await runWithRepairs(
            async (repairAttempt, previousValidation) => {
              record.repairAttempts = repairAttempt;
              taskState.tasks[task.id] = taskEntry(taskState.tasks[task.id], {
                status: "RUNNING",
                repairAttempts: repairAttempt,
              });
              await atomicWriteJson(statePath, taskState);
              const prompt =
                repairAttempt === 0
                  ? taskPrompt(task, persistedContext.text)
                  : repairPrompt(task, previousValidation);
              const remaining = deadline - Date.now();
              const turn =
                remaining <= 0
                  ? {
                      outcome: "timed_out" as const,
                      commands: [],
                      durationMs: 0,
                      usage: null,
                      reason: "Task exceeded its 30 minute timeout.",
                    }
                  : await runCodexTurn(
                      thread,
                      prompt,
                      remaining,
                      async (command) => {
                        addCommandStep(record, command, repairAttempt);
                        await flushRecord();
                      },
                    );
              record.turns.push({
                number: repairAttempt,
                outcome: turn.outcome,
                durationMs: turn.durationMs,
                usage: turn.usage,
                ...(turn.reason ? { reason: turn.reason } : {}),
              });
              await flushRecord();
              return turn;
            },
            async (repairAttempt, turn, validation) => {
              record.repairAttempts = repairAttempt;
              record.validation = validation;
              if (turn.outcome !== "completed") record.reason = turn.reason;
              await flushRecord();
            },
          );

          record.status = executed.status;
          record.repairAttempts = executed.repairAttempts;
          record.validation = executed.validation;
          if (executed.reason) record.reason = executed.reason;
          resultCode =
            executed.status === "DONE"
              ? 0
              : executed.status === "BLOCKED_EXTERNAL"
                ? 3
                : 1;
          await flushRecord();
          taskState.tasks[task.id] = taskEntry(taskState.tasks[task.id], {
            status: executed.status,
            repairAttempts: executed.repairAttempts,
            exitCode:
              executed.status === "DONE"
                ? 0
                : (executed.validation.checks.find(
                    (check) => check.result === "failed",
                  )?.exitCode ?? null),
            completedAt:
              executed.status === "DONE" ? new Date().toISOString() : null,
            reason: executed.reason ?? null,
          });
        }
        await atomicWriteJson(statePath, taskState);
      }
    }
  } catch (error) {
    record.status = "FAILED";
    record.reason =
      error instanceof Error ? error.message : "Autopilot execution failed.";
    resultCode = 1;
    if (state?.tasks[task.id]?.status === "RUNNING") {
      state.tasks[task.id] = taskEntry(state.tasks[task.id], {
        status: "FAILED",
        exitCode: null,
        reason: "Autopilot stopped before recording a completed task result.",
      });
      await atomicWriteJson(statePath, state);
    }
  } finally {
    record.finishedAt = new Date().toISOString();
    record.runnerExitCode = resultCode;
    try {
      await flushRecord();
    } finally {
      await lock.release();
    }
  }

  console.info(`${taskId}: ${record.status}; execution record: ${logPath}`);
  return resultCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error("Autopilot failed before starting the task.");
      process.exitCode = 1;
    });
}
