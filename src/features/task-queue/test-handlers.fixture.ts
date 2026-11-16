import type { TaskHandlerRegistry } from "./types.ts";

function waitForAbort(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export const taskHandlers: TaskHandlerRegistry = {
  SUCCEED: async () => ({ resultCode: "PROOF_COMPLETED" }),
  SLOW: async ({ signal }) => {
    await waitForAbort(signal);
    return { resultCode: "ABORTED" };
  },
  BLOCKED: async () => ({
    executionStatus: "BLOCKED_EXTERNAL",
    resultCode: "SOURCE_UNAVAILABLE",
    errorCode: "SOURCE_UNAVAILABLE",
  }),
  INVALID_RESULT: async () => ({ resultCode: "invalid result" }),
};
