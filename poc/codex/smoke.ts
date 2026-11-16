import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Codex } from "@openai/codex-sdk";
import { CODEX_CONFIG_OVERRIDES } from "../../src/features/ai/codex-adapter/config.ts";

const modes = [
  "success",
  "no-auth",
  "offline",
  "offline-host-stop",
  "simulated-429",
  "simulated-stream-error",
  "simulated-auth-error",
] as const;
type Mode = (typeof modes)[number];

const mode = process.argv[2] ?? "success";
assert(
  modes.includes(mode as Mode),
  "mode must be success, no-auth, offline, offline-host-stop, simulated-429, simulated-stream-error, or simulated-auth-error",
);

const sdkEntry = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
const sdkRequire = createRequire(sdkEntry);
const codexPackageJson = sdkRequire.resolve("@openai/codex/package.json");
const codexMetadata = JSON.parse(readFileSync(codexPackageJson, "utf8")) as {
  bin?: string | Record<string, string>;
};
const codexBinary =
  typeof codexMetadata.bin === "string"
    ? codexMetadata.bin
    : codexMetadata.bin?.codex;
assert(codexBinary, "installed Codex CLI entrypoint is missing");
const codexCli = resolve(dirname(codexPackageJson), codexBinary);

const outputSchema = {
  type: "object",
  properties: { status: { type: "string", enum: ["READY"] } },
  required: ["status"],
  additionalProperties: false,
} as const;

const environmentKeys = [
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
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
] as const;

function cliEnvironment(codexHome: string): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ...Object.fromEntries(
      environmentKeys.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]!]],
      ),
    ),
    CODEX_HOME: codexHome,
  };
}

function isNotLoggedIn(codexHome: string): boolean {
  const result = spawnSync(process.execPath, [codexCli, "login", "status"], {
    encoding: "utf8",
    env: {
      ...cliEnvironment(codexHome),
      NODE_ENV: process.env.NODE_ENV ?? "production",
    },
    timeout: 15_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return /not logged in|not authenticated|unauthori[sz]ed/i.test(output);
}

function classifyError(error: unknown): {
  category:
    | "authentication_required"
    | "rate_limited"
    | "network_unavailable"
    | "timed_out"
    | "other";
  code: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b|rate.?limit|quota|usage limit/i.test(message)) {
    return { category: "rate_limited", code: "rate_limit" };
  }
  if (
    /\b401\b|\b403\b|unauthori[sz]ed|unauthenticated|not authenticated|authentication required|not logged|missing.*(credential|api key)|(?:need|please|must).{0,30}(?:login|log in|sign in)/i.test(
      message,
    )
  ) {
    return {
      category: "authentication_required",
      code: "credentials_required",
    };
  }
  if (/abort|timed? ?out|deadline/i.test(message)) {
    return { category: "timed_out", code: "timeout" };
  }
  if (/ECONNREFUSED/i.test(message)) {
    return { category: "network_unavailable", code: "connection_refused" };
  }
  if (/ECONN|socket|fetch failed|network|connect/i.test(message)) {
    return { category: "network_unavailable", code: "connection_failure" };
  }
  return { category: "other", code: "unclassified" };
}

async function startLocalFailureEndpoint(
  failureMode:
    "disconnect" | "rate-limit" | "stream-error" | "auth-error" = "disconnect",
): Promise<{
  server: Server;
  baseUrl: string;
  requests: { count: number; byPath: Record<string, number> };
}> {
  const requests = { count: 0, byPath: {} as Record<string, number> };
  const server = createServer((request, response) => {
    requests.count += 1;
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.byPath[path] = (requests.byPath[path] ?? 0) + 1;
    if (failureMode === "rate-limit" || failureMode === "auth-error") {
      request.resume();
      request.once("end", () => {
        response.writeHead(failureMode === "auth-error" ? 401 : 429, {
          "Content-Type": "application/json",
        });
        response.end(
          failureMode === "auth-error"
            ? '{"error":{"message":"local authentication fixture","type":"invalid_request_error","code":"invalid_api_key"}}'
            : '{"error":{"message":"local quota fixture","type":"rate_limit_error","code":"rate_limit_exceeded"}}',
        );
      });
    } else if (failureMode === "stream-error") {
      request.resume();
      request.once("end", () => {
        const responseBody = {
          type: "response.created",
          response: {
            id: "resp_local",
            object: "response",
            status: "in_progress",
            model: "probe-model",
            output: [],
          },
          sequence_number: 0,
        };
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        response.write(
          `event: response.created\ndata: ${JSON.stringify(responseBody)}\n\n`,
        );
        response.write(
          `event: response.in_progress\ndata: ${JSON.stringify({ ...responseBody, type: "response.in_progress", sequence_number: 1 })}\n\n`,
        );
        response.end(
          `event: error\ndata: ${JSON.stringify({ type: "error", code: "validation_error", message: "local invalid request", param: "", sequence_number: 2 })}\n\n`,
        );
      });
    } else {
      request.socket.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "local endpoint did not bind");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

const startedAt = performance.now();
const eventTypes: string[] = [];
const temporaryRoot = await mkdtemp(join(tmpdir(), "stock-monitor-codex-poc-"));
const workingDirectory = join(temporaryRoot, "work");
const temporaryCodexHome = join(temporaryRoot, "home");
await Promise.all([mkdir(workingDirectory), mkdir(temporaryCodexHome)]);

let offlineEndpoint:
  Awaited<ReturnType<typeof startLocalFailureEndpoint>> | undefined;
let schemaValid = false;
let workspaceClean = true;
let noAuthConfirmed: boolean | undefined;
let turnCompleted = false;
let failure: unknown;
let networkErrorEventCount = 0;
let hostStopAbort = false;
const hostPolicyAbort = new AbortController();

try {
  if (
    mode === "offline" ||
    mode === "offline-host-stop" ||
    mode === "simulated-429" ||
    mode === "simulated-stream-error" ||
    mode === "simulated-auth-error"
  ) {
    offlineEndpoint = await startLocalFailureEndpoint(
      mode === "simulated-429"
        ? "rate-limit"
        : mode === "simulated-stream-error"
          ? "stream-error"
          : mode === "simulated-auth-error"
            ? "auth-error"
            : "disconnect",
    );
  }
  const codexHome =
    mode === "success"
      ? (process.env.CODEX_HOME ?? join(homedir(), ".codex"))
      : temporaryCodexHome;
  if (mode === "no-auth") {
    noAuthConfirmed = isNotLoggedIn(codexHome);
    assert(
      noAuthConfirmed,
      "temporary CODEX_HOME still reports an authenticated session",
    );
  }
  const environment = cliEnvironment(codexHome);
  if (
    mode === "offline" ||
    mode === "offline-host-stop" ||
    mode === "simulated-429" ||
    mode === "simulated-stream-error" ||
    mode === "simulated-auth-error"
  ) {
    environment.CODEX_API_KEY = "local-only-placeholder";
  }
  const codex = new Codex({
    env: environment,
    configOverrides: offlineEndpoint
      ? [
          ...CODEX_CONFIG_OVERRIDES,
          `model_providers.stock_monitor_openai.base_url=${JSON.stringify(offlineEndpoint.baseUrl)}`,
        ]
      : CODEX_CONFIG_OVERRIDES,
  });
  const thread = codex.startThread({
    workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never",
    modelReasoningEffort: "low",
  });
  const { events } = await thread.runStreamed(
    'Return exactly {"status":"READY"}. Do not use tools, access files, or request external data.',
    {
      outputSchema,
      signal: AbortSignal.any([
        AbortSignal.timeout(90_000),
        hostPolicyAbort.signal,
      ]),
    },
  );

  let response = "";
  for await (const event of events) {
    eventTypes.push(event.type);
    if (
      event.type === "item.completed" &&
      event.item.type === "agent_message"
    ) {
      response = event.item.text;
    } else if (event.type === "turn.completed") {
      turnCompleted = true;
    } else if (event.type === "turn.failed" || event.type === "error") {
      failure =
        event.type === "turn.failed" ? event.error.message : event.message;
      if (
        (mode === "offline-host-stop" ||
          mode === "simulated-429" ||
          mode === "simulated-stream-error" ||
          mode === "simulated-auth-error") &&
        (event.type === "error" || event.type === "turn.failed")
      ) {
        const message =
          event.type === "turn.failed" ? event.error.message : event.message;
        if (classifyError(message).category === "network_unavailable") {
          networkErrorEventCount += 1;
        }
        hostStopAbort = true;
        hostPolicyAbort.abort();
        break;
      }
    }
  }

  if (failure) throw new Error(String(failure));
  assert(turnCompleted, "stream ended without turn.completed");
  assert.deepEqual(JSON.parse(response), { status: "READY" });
  schemaValid = true;
} catch (error) {
  failure = error;
} finally {
  if (offlineEndpoint) {
    await new Promise<void>((resolve) =>
      offlineEndpoint!.server.close(() => resolve()),
    );
  }
}

try {
  assert.deepEqual(
    await readdir(workingDirectory),
    [],
    "read-only working directory changed",
  );
} catch (error) {
  workspaceClean = false;
  failure ??= error;
}

// shortcut: the SDK kills its child without awaiting exit; upgrade when it exposes an awaitable close handle.
await rm(temporaryRoot, {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 50,
});

const classifiedFailure = failure ? classifyError(failure) : undefined;
const classification =
  hostStopAbort && classifiedFailure?.category === "other"
    ? { category: "network_unavailable" as const, code: "host_stop" }
    : classifiedFailure;
const category = classification?.category;
const offlineRequestCount = offlineEndpoint?.requests.count;
const expectedFailure =
  (mode === "no-auth" && noAuthConfirmed && Boolean(category)) ||
  (mode === "offline" &&
    category === "network_unavailable" &&
    (offlineRequestCount ?? 0) > 0 &&
    (offlineRequestCount ?? Infinity) <= 3) ||
  (mode === "offline-host-stop" &&
    hostStopAbort &&
    networkErrorEventCount === 1 &&
    (offlineRequestCount ?? 0) > 0 &&
    (offlineRequestCount ?? Infinity) <= 3) ||
  (mode === "simulated-429" &&
    hostStopAbort &&
    category === "rate_limited" &&
    (offlineRequestCount ?? 0) > 0 &&
    (offlineRequestCount ?? Infinity) <= 3) ||
  (mode === "simulated-stream-error" &&
    hostStopAbort &&
    (offlineRequestCount ?? 0) > 0 &&
    (offlineRequestCount ?? Infinity) <= 3) ||
  (mode === "simulated-auth-error" &&
    hostStopAbort &&
    offlineRequestCount === 1);
const passed =
  workspaceClean &&
  (mode === "success"
    ? schemaValid && !failure
    : expectedFailure && !schemaValid);

console.log(
  JSON.stringify({
    mode,
    outcome: passed ? "passed" : "failed",
    elapsedMs: Math.round(performance.now() - startedAt),
    eventTypes,
    schemaValid,
    workspaceClean,
    ...(noAuthConfirmed ? { authState: "not_logged_in" } : {}),
    ...(offlineRequestCount === undefined ? {} : { offlineRequestCount }),
    ...(networkErrorEventCount === 0 ? {} : { networkErrorEventCount }),
    ...(offlineEndpoint
      ? { offlineRequestsByPath: offlineEndpoint.requests.byPath }
      : {}),
    ...(category ? { errorCategory: category } : {}),
    ...(classification ? { errorCode: classification.code } : {}),
  }),
);

if (!passed) process.exitCode = 1;
