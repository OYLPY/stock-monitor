import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  listTaskRuns: vi.fn((): unknown[] => []),
  readWorkerStatus: vi.fn(() => ({ running: false })),
}));

vi.mock("@/db", () => ({
  getLocalDatabasePath: () => "test-database.sqlite",
  openDatabase: async () => ({ client: { close: vi.fn() } }),
}));
vi.mock("@/features/task-queue/queue", () => ({
  listTaskRuns: pageMocks.listTaskRuns,
  readWorkerStatus: pageMocks.readWorkerStatus,
}));
vi.mock("@/components/tasks/cancel-task-button", async () => {
  const React = await import("react");
  return {
    CancelTaskButton: ({ label }: { label: string }) =>
      React.createElement("button", { type: "button" }, `取消 ${label}`),
  };
});

import TasksPage from "@/app/tasks/page";

describe("tasks page", () => {
  it("renders a real persisted queue with task status and report navigation", async () => {
    pageMocks.listTaskRuns.mockReturnValue([
      {
        id: "0c72b1db-1577-4828-9e25-82af2eadd323",
        kind: "REPORT",
        label: "晨报",
        executionStatus: "PENDING",
        attemptCount: 0,
        cancellationRequestedAtMs: null,
        resultCode: null,
        errorCode: null,
        createdAtMs: Date.UTC(2026, 10, 19),
        startedAtMs: null,
        finishedAtMs: null,
      },
    ]);
    pageMocks.readWorkerStatus.mockReturnValue({ running: false });

    const page = await TasksPage();
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("任务队列");
    expect(html).toContain("本机 Worker 未运行");
    expect(html).toContain("排队中");
    expect(html).toContain("取消 晨报");
    expect(html).toContain(
      'href="/reports?task=0c72b1db-1577-4828-9e25-82af2eadd323"',
    );
    expect(html).toContain("时间为日本时间（JST）");
  });

  it("shows an actual empty state when the durable queue has no task", async () => {
    pageMocks.listTaskRuns.mockReturnValue([]);
    const page = await TasksPage();
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("队列为空");
    expect(html).not.toContain("NOT_VERIFIED");
  });
});
