import { access } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@openai/codex-sdk";
import { createTestDatabase } from "../../../db/test-database";
import {
  appendSourceRecord,
  listAuditEvents,
  registerSource,
  verifyAuditTrail,
} from "../../evidence/repository";
import { recordDisclosureCitation } from "../../../providers/disclosures";
import { runCodexTask } from "./index";

const sdkMocks = vi.hoisted(() => ({
  codexOptions: undefined as Record<string, unknown> | undefined,
  threadOptions: undefined as Record<string, unknown> | undefined,
  turnOptions: undefined as
    { signal: AbortSignal; outputSchema?: unknown } | undefined,
  runStreamed: vi.fn(),
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    constructor(options: Record<string, unknown>) {
      sdkMocks.codexOptions = options;
    }

    startThread(options: Record<string, unknown>) {
      sdkMocks.threadOptions = options;
      return {
        runStreamed: (
          prompt: string,
          turnOptions: { signal: AbortSignal; outputSchema?: unknown },
        ) => {
          sdkMocks.turnOptions = turnOptions;
          return sdkMocks.runStreamed(prompt, turnOptions);
        },
      };
    }
  },
}));

function eventStream(events: ThreadEvent[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function createSource() {
  const fixture = await createTestDatabase();
  const citation = recordDisclosureCitation(fixture.database, {
    provider: "sec.edgar",
    externalId: "0000320193-26-000123",
    referenceUrl:
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/index.htm",
    title: "8-K filing",
    rawTimeText: "2026-11-16T16:05:00-05:00",
  });
  return { fixture, sourceRecordId: citation.record.id };
}

async function createFixtureSource() {
  const fixture = await createTestDatabase();
  const source = registerSource(fixture.database, {
    sourceKey: "test.fixture",
    publisher: "Synthetic test fixture",
    sourceType: "OTHER",
    authorityRole: "FIXTURE",
    referenceUrl: null,
    licenseUrl: null,
    licenseStatus: "UNKNOWN",
    credentialRequirement: "NOT_REQUIRED",
  });
  const record = appendSourceRecord(fixture.database, {
    sourceId: source.id,
    recordKey: "fixture:sample",
    recordType: "DISCLOSURE",
    recordVersion: 1,
    supersedesRecordId: null,
    publishedAtMs: null,
    occurredAtMs: null,
    availableAtMs: null,
    rawTimeText: null,
    sourceTimeZone: null,
    canonicalUrl: null,
    dataClass: "FIXTURE",
    content: "synthetic fixture",
  });
  return { fixture, sourceRecordId: record.id };
}

function successfulEvents(): ThreadEvent[] {
  return [
    { type: "thread.started", thread_id: "thread-secret" },
    { type: "turn.started" },
    {
      type: "item.updated",
      item: { id: "message-1", type: "agent_message", text: "draft" },
    },
    {
      type: "item.completed",
      item: {
        id: "message-1",
        type: "agent_message",
        text: "candidate response",
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 4,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 3,
        reasoning_output_tokens: 0,
      },
    },
  ];
}

describe("Codex task adapter", () => {
  beforeEach(() => {
    sdkMocks.codexOptions = undefined;
    sdkMocks.threadOptions = undefined;
    sdkMocks.turnOptions = undefined;
    sdkMocks.runStreamed.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns a traced, unverified result and only passes a disabled tool surface", async () => {
    const { fixture, sourceRecordId } = await createSource();
    const oldApiKey = process.env.CODEX_API_KEY;
    const oldAccessToken = process.env.CODEX_ACCESS_TOKEN;
    process.env.CODEX_API_KEY = "api-key-sentinel";
    process.env.CODEX_ACCESS_TOKEN = "access-token-sentinel";
    sdkMocks.runStreamed.mockImplementation(async () => ({
      events: eventStream(successfulEvents()),
    }));
    const events: unknown[] = [];

    try {
      const result = await runCodexTask(fixture.database, {
        prompt: "private prompt sentinel",
        sourceRecordIds: [sourceRecordId],
        outputSchema: { type: "object" },
        onEvent: (event) => events.push(event),
      });

      expect(result).toMatchObject({
        status: "DONE",
        output: "candidate response",
        verificationStatus: "NOT_VERIFIED",
        dataClass: "NOT_VERIFIED",
        sourceReferences: [{ id: sourceRecordId, dataClass: "NOT_VERIFIED" }],
      });
      expect(result.sourceReferences[0]).toMatchObject({
        canonicalUrl:
          "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/index.htm",
      });
      expect(result.sourceReferences[0].collectedAtMs).toMatch(/^\d+$/);
      expect(sdkMocks.turnOptions?.outputSchema).toEqual({ type: "object" });
      expect(events.map((event) => (event as { type: string }).type)).toEqual([
        "started",
        "thread_started",
        "turn_started",
        "response_updated",
        "response_updated",
        "completed",
      ]);
      expect(
        events.every(
          (event) => (event as { callId: string }).callId === result.callId,
        ),
      ).toBe(true);
      expect(sdkMocks.codexOptions?.configOverrides).toEqual(
        expect.arrayContaining([
          'model="gpt-5.6-sol"',
          'model_provider="stock_monitor_openai"',
          'model_providers.stock_monitor_openai.name="OpenAI"',
          'model_providers.stock_monitor_openai.wire_api="responses"',
          "model_providers.stock_monitor_openai.requires_openai_auth=true",
          "model_providers.stock_monitor_openai.request_max_retries=0",
          "model_providers.stock_monitor_openai.stream_max_retries=0",
          "model_providers.stock_monitor_openai.supports_websockets=false",
          "features.unbounded_connection_retries=false",
          "features.shell_tool=false",
          "features.apps=false",
          "features.auth_elicitation=false",
          "features.browser_use=false",
          "features.computer_use=false",
          "features.hooks=false",
          "features.memories=false",
          "agents.enabled=false",
          "features.multi_agent_v2=false",
          "mcp_servers={}",
        ]),
      );
      expect(sdkMocks.threadOptions).toMatchObject({
        sandboxMode: "read-only",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never",
      });
      expect(sdkMocks.threadOptions).not.toHaveProperty(
        "additionalDirectories",
      );
      const workingDirectory = sdkMocks.threadOptions?.workingDirectory as
        string | undefined;
      expect(workingDirectory).toBeTruthy();
      await expect(access(workingDirectory!)).rejects.toThrow();
      const passedEnv = sdkMocks.codexOptions?.env as
        Record<string, string> | undefined;
      expect(passedEnv?.CODEX_API_KEY).toBeUndefined();
      expect(passedEnv?.CODEX_ACCESS_TOKEN).toBeUndefined();
      expect(JSON.stringify(events)).not.toContain("thread-secret");

      const callAudit = listAuditEvents(fixture.database).filter(
        (event) => event.entityType === "CODEX_CALL",
      );
      expect(callAudit.map((event) => event.action)).toEqual([
        "STARTED",
        "DONE",
      ]);
      expect(callAudit[0].entityId).toBe(result.callId);
      const serializedAudit = JSON.stringify(callAudit, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      expect(serializedAudit).not.toContain("private prompt sentinel");
      expect(serializedAudit).not.toContain("candidate response");
      expect(verifyAuditTrail(fixture.database)).toBe(true);
    } finally {
      if (oldApiKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = oldApiKey;
      if (oldAccessToken === undefined) delete process.env.CODEX_ACCESS_TOKEN;
      else process.env.CODEX_ACCESS_TOKEN = oldAccessToken;
      await fixture.cleanup();
    }
  });

  it("keeps fixture-derived model output marked DEMO_ONLY", async () => {
    const { fixture, sourceRecordId } = await createFixtureSource();
    sdkMocks.runStreamed.mockImplementation(async () => ({
      events: eventStream(successfulEvents()),
    }));

    try {
      const result = await runCodexTask(fixture.database, {
        prompt: "Summarize this evidence.",
        sourceRecordIds: [sourceRecordId],
      });

      expect(result).toMatchObject({
        status: "DONE",
        dataClass: "DEMO_ONLY",
        verificationStatus: "NOT_VERIFIED",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks concurrent calls and does not start a second SDK turn", async () => {
    const { fixture } = await createSource();
    let releaseStream!: () => void;
    let streamStarted!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    sdkMocks.runStreamed.mockImplementation(async () => ({
      events: (async function* () {
        streamStarted();
        await streamGate;
        yield* eventStream(successfulEvents());
      })(),
    }));

    try {
      const firstCall = runCodexTask(fixture.database, {
        prompt: "first",
        sourceRecordIds: [],
      });
      await started;
      const secondResult = await runCodexTask(fixture.database, {
        prompt: "second",
        sourceRecordIds: [],
      });
      expect(secondResult).toMatchObject({
        status: "BLOCKED_EXTERNAL",
        errorCode: "CALL_IN_PROGRESS",
      });
      expect(sdkMocks.runStreamed).toHaveBeenCalledTimes(1);
      releaseStream();
      expect(await firstCall).toMatchObject({ status: "DONE" });
    } finally {
      releaseStream();
      await fixture.cleanup();
    }
  });

  it("turns a visible rate-limit event into a blocked state without leaking its text", async () => {
    const { fixture } = await createSource();
    sdkMocks.runStreamed.mockImplementation(async () => ({
      events: eventStream([
        { type: "error", message: "429 rate_limit_error secret response" },
      ]),
    }));

    try {
      const result = await runCodexTask(fixture.database, {
        prompt: "safe prompt",
        sourceRecordIds: [],
      });

      expect(result).toMatchObject({
        status: "BLOCKED_EXTERNAL",
        errorCode: "RATE_LIMITED",
      });
      expect(JSON.stringify(result)).not.toContain("secret response");
      expect(sdkMocks.turnOptions?.signal.aborted).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("continues after non-fatal SDK error items", async () => {
    const fixture = await createTestDatabase();
    sdkMocks.runStreamed.mockImplementation(async () => ({
      events: eventStream([
        {
          type: "item.completed",
          item: {
            id: "config-notice",
            type: "error",
            message: "A disabled optional feature is unavailable.",
          },
        },
        ...successfulEvents(),
      ]),
    }));

    try {
      await expect(
        runCodexTask(fixture.database, {
          prompt: "safe prompt",
          sourceRecordIds: [],
        }),
      ).resolves.toMatchObject({
        status: "DONE",
        output: "candidate response",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ["authentication", "401 unauthorized secret response", "AUTH_REQUIRED"],
    ["network", "ECONNRESET secret response", "NETWORK_UNAVAILABLE"],
  ] as const)(
    "maps %s failures to a stable blocked state",
    async (_, message, errorCode) => {
      const { fixture } = await createSource();
      sdkMocks.runStreamed.mockImplementation(async () => ({
        events: eventStream([{ type: "error", message }]),
      }));

      try {
        const result = await runCodexTask(fixture.database, {
          prompt: "safe prompt",
          sourceRecordIds: [],
        });

        expect(result).toMatchObject({
          status: "BLOCKED_EXTERNAL",
          errorCode,
        });
        expect(JSON.stringify(result)).not.toContain("secret response");
        expect(sdkMocks.turnOptions?.signal.aborted).toBe(true);
        expect(
          listAuditEvents(fixture.database)
            .filter((event) => event.entityType === "CODEX_CALL")
            .map((event) => event.action),
        ).toEqual(["STARTED", "BLOCKED_EXTERNAL"]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("aborts before accepting any unexpected tool call", async () => {
    const { fixture } = await createSource();
    sdkMocks.runStreamed.mockImplementation(async () => ({
      events: eventStream([
        {
          type: "item.started",
          item: {
            id: "command-1",
            type: "command_execution",
            command: "printenv",
            aggregated_output: "",
            status: "in_progress",
          },
        },
      ]),
    }));

    try {
      const result = await runCodexTask(fixture.database, {
        prompt: "safe prompt",
        sourceRecordIds: [],
      });

      expect(result).toMatchObject({
        status: "FAILED",
        errorCode: "TOOL_ACCESS_DENIED",
      });
      expect(sdkMocks.turnOptions?.signal.aborted).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("uses the caller signal to cancel and discards any partial result", async () => {
    const { fixture } = await createSource();
    const controller = new AbortController();
    sdkMocks.runStreamed.mockImplementation(async (_prompt, options) => ({
      events: (async function* () {
        await waitForAbort(options.signal);
      })(),
    }));

    try {
      const pending = runCodexTask(fixture.database, {
        prompt: "safe prompt",
        sourceRecordIds: [],
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 0);
      await expect(pending).resolves.toMatchObject({
        status: "SKIPPED",
        errorCode: "CANCELLED",
      });
    } finally {
      controller.abort();
      await fixture.cleanup();
    }
  });

  it("returns a timed-out failure when the finite turn deadline aborts the SDK", async () => {
    const { fixture } = await createSource();
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    sdkMocks.runStreamed.mockImplementation(async (_prompt, options) => {
      setTimeout(() => timeout.abort(), 0);
      return {
        events: (async function* () {
          await waitForAbort(options.signal);
        })(),
      };
    });

    try {
      await expect(
        runCodexTask(fixture.database, {
          prompt: "safe prompt",
          sourceRecordIds: [],
        }),
      ).resolves.toMatchObject({
        status: "FAILED",
        errorCode: "TIMED_OUT",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not call Codex when a source record reference is missing", async () => {
    const fixture = await createTestDatabase();

    try {
      const result = await runCodexTask(fixture.database, {
        prompt: "safe prompt",
        sourceRecordIds: ["missing-source-record"],
      });

      expect(result).toMatchObject({
        status: "FAILED",
        errorCode: "INVALID_SOURCE_REFERENCE",
      });
      expect(sdkMocks.runStreamed).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});
