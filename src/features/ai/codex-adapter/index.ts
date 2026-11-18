import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Codex, type Usage } from "@openai/codex-sdk";
import { inArray } from "drizzle-orm";
import type { AppDatabase } from "../../../db/index.ts";
import { sourceRecords } from "../../../db/schema.ts";
import { MAX_JSON_BODY_BYTES } from "../../../lib/api/request.ts";
import { recordAuditEvent } from "../../evidence/repository.ts";
import { CODEX_CONFIG_OVERRIDES } from "./config.ts";

const TURN_TIMEOUT_MS = 90_000;
const CODEX_ENV_KEYS = [
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "PROGRAMFILES",
  "SYSTEMDRIVE",
  "PROCESSOR_ARCHITECTURE",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

// shortcut: this limits one Node process, add a SQLite claim if multiple workers share a database.
let activeCall = false;

export type CodexCallEvent =
  | { type: "started"; callId: string; atMs: number }
  | { type: "thread_started"; callId: string; atMs: number }
  | { type: "turn_started"; callId: string; atMs: number }
  | { type: "response_updated"; callId: string; text: string }
  | { type: "completed"; callId: string; atMs: number }
  | {
      type: "failed";
      callId: string;
      code: CodexCallFailureCode;
      atMs: number;
    };

export type CodexCallFailureCode =
  | "CALL_IN_PROGRESS"
  | "INVALID_INPUT"
  | "INVALID_SOURCE_REFERENCE"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "NETWORK_UNAVAILABLE"
  | "TIMED_OUT"
  | "CANCELLED"
  | "TOOL_ACCESS_DENIED"
  | "CODEX_UNAVAILABLE"
  | "AUDIT_UNAVAILABLE"
  | "TEMP_CLEANUP_FAILED";

export interface CodexSourceReference {
  id: string;
  canonicalUrl: string | null;
  publishedAtMs: string | null;
  occurredAtMs: string | null;
  availableAtMs: string | null;
  collectedAtMs: string;
  dataClass: string;
}

interface CodexCallBase {
  callId: string;
  startedAtMs: number;
  completedAtMs: number;
  sourceReferences: CodexSourceReference[];
  dataClass: "NOT_VERIFIED" | "DEMO_ONLY";
}

export type CodexCallResult =
  | (CodexCallBase & {
      status: "DONE";
      output: string;
      verificationStatus: "NOT_VERIFIED";
      usage: Usage | null;
    })
  | (CodexCallBase & {
      status: "BLOCKED_EXTERNAL" | "FAILED" | "SKIPPED";
      errorCode: CodexCallFailureCode;
      verificationStatus: "NOT_VERIFIED";
    });

export interface CodexCallInput {
  prompt: string;
  sourceRecordIds: readonly string[];
  outputSchema?: unknown;
  signal?: AbortSignal;
  onEvent?: (event: CodexCallEvent) => void;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function codexEnvironment(): Record<string, string> {
  const env = Object.fromEntries(
    CODEX_ENV_KEYS.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]!]],
    ),
  );
  env.CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
  env.NODE_ENV = process.env.NODE_ENV || "production";

  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] as const) {
    const value = process.env[key];
    if (!value) continue;
    try {
      const proxy = new URL(value);
      if (!proxy.username && !proxy.password && !proxy.search && !proxy.hash) {
        env[key] = proxy.origin;
      }
    } catch {
      // Proxy values with credentials or unsupported formats stay out of the Codex process.
    }
  }
  if (process.env.NO_PROXY) env.NO_PROXY = process.env.NO_PROXY;
  return env;
}

function sourceReferences(
  database: AppDatabase,
  ids: readonly string[],
): CodexSourceReference[] | null {
  if (new Set(ids).size !== ids.length) return null;
  if (ids.length === 0) return [];

  const rows = database.orm
    .select({
      id: sourceRecords.id,
      canonicalUrl: sourceRecords.canonicalUrl,
      publishedAtMs: sourceRecords.publishedAtMs,
      occurredAtMs: sourceRecords.occurredAtMs,
      availableAtMs: sourceRecords.availableAtMs,
      collectedAtMs: sourceRecords.collectedAtMs,
      dataClass: sourceRecords.dataClass,
    })
    .from(sourceRecords)
    .where(inArray(sourceRecords.id, [...ids]))
    .all();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  if (rowsById.size !== ids.length) return null;

  return ids.map((id) => {
    const row = rowsById.get(id)!;
    return {
      id,
      canonicalUrl: row.canonicalUrl,
      publishedAtMs: row.publishedAtMs?.toString() ?? null,
      occurredAtMs: row.occurredAtMs?.toString() ?? null,
      availableAtMs: row.availableAtMs?.toString() ?? null,
      collectedAtMs: row.collectedAtMs.toString(),
      dataClass: row.dataClass,
    };
  });
}

function failureCode(message: string): CodexCallFailureCode {
  if (
    /\b401\b|\b403\b|unauthori[sz]ed|not authenticated|not logged in|credentials required/i.test(
      message,
    )
  ) {
    return "AUTH_REQUIRED";
  }
  if (/429|rate.?limit|quota|usage limit/i.test(message)) {
    return "RATE_LIMITED";
  }
  if (/abort|cancel/i.test(message)) return "CANCELLED";
  if (/timed? ?out|deadline/i.test(message)) return "TIMED_OUT";
  if (/ECONN|socket|fetch failed|network|connect/i.test(message)) {
    return "NETWORK_UNAVAILABLE";
  }
  return "CODEX_UNAVAILABLE";
}

function resultStatus(
  code: CodexCallFailureCode,
): "BLOCKED_EXTERNAL" | "FAILED" | "SKIPPED" {
  if (
    code === "AUTH_REQUIRED" ||
    code === "RATE_LIMITED" ||
    code === "NETWORK_UNAVAILABLE" ||
    code === "CODEX_UNAVAILABLE" ||
    code === "CALL_IN_PROGRESS"
  ) {
    return "BLOCKED_EXTERNAL";
  }
  if (code === "CANCELLED") return "SKIPPED";
  return "FAILED";
}

function recordCallAudit(
  database: AppDatabase,
  callId: string,
  action: string,
  payload: unknown,
): void {
  recordAuditEvent(database, {
    entityType: "CODEX_CALL",
    entityId: callId,
    action,
    payload,
  });
}

function auditPayload(result: CodexCallResult, promptHash: string) {
  return result.status === "DONE"
    ? {
        promptHash,
        sourceRecordIds: result.sourceReferences.map((source) => source.id),
        outputHash: sha256(result.output),
        usage: result.usage,
      }
    : {
        promptHash,
        sourceRecordIds: result.sourceReferences.map((source) => source.id),
        errorCode: result.errorCode,
      };
}

function notify(input: CodexCallInput, event: CodexCallEvent): void {
  input.onEvent?.(event);
}

export async function runCodexTask(
  database: AppDatabase,
  input: CodexCallInput,
): Promise<CodexCallResult> {
  const callId = randomUUID();
  const startedAtMs = Date.now();
  const promptHash = sha256(input.prompt);
  let sources: CodexSourceReference[] = [];
  let auditStarted = false;
  let tempDirectory: string | undefined;
  let timeoutSignal: AbortSignal | undefined;
  let stopController: AbortController | undefined;
  let status: CodexCallResult["status"] = "FAILED";
  let code: CodexCallFailureCode = "CODEX_UNAVAILABLE";
  let output = "";
  let usage: Usage | null = null;

  const finish = (resultStatus: CodexCallResult["status"]): CodexCallResult => {
    const completedAtMs = Date.now();
    const result: CodexCallResult =
      resultStatus === "DONE"
        ? {
            callId,
            status: resultStatus,
            startedAtMs,
            completedAtMs,
            sourceReferences: sources,
            dataClass: sources.some((source) => source.dataClass === "FIXTURE")
              ? "DEMO_ONLY"
              : "NOT_VERIFIED",
            output,
            verificationStatus: "NOT_VERIFIED",
            usage,
          }
        : {
            callId,
            status: resultStatus,
            startedAtMs,
            completedAtMs,
            sourceReferences: sources,
            dataClass: sources.some((source) => source.dataClass === "FIXTURE")
              ? "DEMO_ONLY"
              : "NOT_VERIFIED",
            errorCode: code,
            verificationStatus: "NOT_VERIFIED",
          };
    if (auditStarted) {
      try {
        recordCallAudit(
          database,
          callId,
          result.status,
          auditPayload(result, promptHash),
        );
      } catch {
        return {
          ...result,
          status: "FAILED",
          errorCode: "AUDIT_UNAVAILABLE",
        };
      }
    }
    return result;
  };

  if (activeCall) {
    try {
      recordCallAudit(database, callId, "BLOCKED_EXTERNAL", {
        promptHash,
        sourceRecordIds: input.sourceRecordIds,
        errorCode: "CALL_IN_PROGRESS",
      });
    } catch {
      code = "AUDIT_UNAVAILABLE";
      return finish("FAILED");
    }
    code = "CALL_IN_PROGRESS";
    return finish("BLOCKED_EXTERNAL");
  }

  activeCall = true;
  try {
    recordCallAudit(database, callId, "STARTED", {
      promptHash,
      sourceRecordIds: input.sourceRecordIds,
    });
    auditStarted = true;
  } catch {
    code = "AUDIT_UNAVAILABLE";
    activeCall = false;
    return finish("FAILED");
  }

  try {
    if (
      !input.prompt.trim() ||
      Buffer.byteLength(input.prompt, "utf8") > MAX_JSON_BODY_BYTES
    ) {
      code = "INVALID_INPUT";
    } else {
      const loadedSources = sourceReferences(database, input.sourceRecordIds);
      if (!loadedSources) {
        code = "INVALID_SOURCE_REFERENCE";
      } else if (input.signal?.aborted) {
        status = "SKIPPED";
        code = "CANCELLED";
      } else {
        sources = loadedSources;
        tempDirectory = await mkdtemp(join(tmpdir(), "stock-monitor-codex-"));
        timeoutSignal = AbortSignal.timeout(TURN_TIMEOUT_MS);
        stopController = new AbortController();
        const signals = [timeoutSignal, stopController.signal];
        if (input.signal) signals.push(input.signal);
        const signal = AbortSignal.any(signals);
        const codex = new Codex({
          env: codexEnvironment(),
          configOverrides: CODEX_CONFIG_OVERRIDES,
        });
        const thread = codex.startThread({
          workingDirectory: tempDirectory,
          skipGitRepoCheck: true,
          sandboxMode: "read-only",
          networkAccessEnabled: false,
          webSearchMode: "disabled",
          approvalPolicy: "never",
          modelReasoningEffort: "low",
        });
        notify(input, { type: "started", callId, atMs: startedAtMs });

        let turnCompleted = false;
        let failure: CodexCallFailureCode | undefined;
        const { events } = await thread.runStreamed(input.prompt, {
          ...(input.outputSchema === undefined
            ? {}
            : { outputSchema: input.outputSchema }),
          signal,
        });

        // shortcut: Codex CLI hides request counts, abort on its first error event; replace when the SDK exposes an attempt budget.
        for await (const event of events) {
          if (event.type === "thread.started") {
            notify(input, { type: "thread_started", callId, atMs: Date.now() });
          } else if (event.type === "turn.started") {
            notify(input, { type: "turn_started", callId, atMs: Date.now() });
          } else if (event.type === "turn.completed") {
            usage = event.usage;
            turnCompleted = true;
          } else if (event.type === "turn.failed" || event.type === "error") {
            failure = failureCode(
              event.type === "turn.failed"
                ? event.error.message
                : event.message,
            );
            stopController.abort();
            break;
          } else if (
            (event.type === "item.started" ||
              event.type === "item.updated" ||
              event.type === "item.completed") &&
            event.item.type === "agent_message" &&
            event.item.text !== output
          ) {
            output = event.item.text;
            notify(input, { type: "response_updated", callId, text: output });
          } else if (
            (event.type === "item.started" ||
              event.type === "item.updated" ||
              event.type === "item.completed") &&
            event.item.type === "error"
          ) {
            failure = failureCode(event.item.message);
            stopController.abort();
            break;
          } else if (
            (event.type === "item.started" ||
              event.type === "item.updated" ||
              event.type === "item.completed") &&
            event.item.type !== "reasoning"
          ) {
            failure = "TOOL_ACCESS_DENIED";
            stopController.abort();
            break;
          }
        }

        if (input.signal?.aborted) {
          status = "SKIPPED";
          code = "CANCELLED";
        } else if (timeoutSignal.aborted) {
          status = "FAILED";
          code = "TIMED_OUT";
        } else if (failure) {
          status = resultStatus(failure);
          code = failure;
        } else if (!turnCompleted || !output) {
          status = "BLOCKED_EXTERNAL";
          code = "CODEX_UNAVAILABLE";
        } else {
          status = "DONE";
        }
      }
    }
  } catch (error) {
    stopController?.abort();
    if (input.signal?.aborted) {
      status = "SKIPPED";
      code = "CANCELLED";
    } else if (
      timeoutSignal?.aborted ||
      (error instanceof Error && /timed? ?out|deadline/i.test(error.message))
    ) {
      status = "FAILED";
      code = "TIMED_OUT";
    } else {
      code =
        error instanceof Error
          ? failureCode(error.message)
          : "CODEX_UNAVAILABLE";
      status = resultStatus(code);
    }
  } finally {
    if (tempDirectory) {
      try {
        await rm(tempDirectory, { recursive: true, force: true });
      } catch {
        status = "FAILED";
        code = "TEMP_CLEANUP_FAILED";
      }
    }
  }

  const result = finish(status);
  try {
    if (result.status === "DONE") {
      notify(input, { type: "completed", callId, atMs: result.completedAtMs });
    } else {
      notify(input, {
        type: "failed",
        callId,
        code: result.errorCode,
        atMs: result.completedAtMs,
      });
    }
    return result;
  } finally {
    activeCall = false;
  }
}
