import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  listNotificationDecisions: vi.fn((): unknown[] => []),
  listNotifications: vi.fn((): unknown[] => []),
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
vi.mock("@/features/alerts/alerts", () => ({
  listNotificationDecisions: pageMocks.listNotificationDecisions,
  listNotifications: pageMocks.listNotifications,
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
    pageMocks.listNotifications.mockReturnValue([]);
    pageMocks.listNotificationDecisions.mockReturnValue([]);
    pageMocks.readWorkerStatus.mockReturnValue({ running: false });

    const page = await TasksPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("任务队列");
    expect(html).toContain("市场提醒");
    expect(html).toContain("运行市场扫描");
    expect(html).toContain("暂无已核验提醒");
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
    pageMocks.listNotifications.mockReturnValue([]);
    pageMocks.listNotificationDecisions.mockReturnValue([]);
    const page = await TasksPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("队列为空");
    expect(html).not.toContain("NOT_VERIFIED");
  });

  it("renders saved notifications and their decision reasons as separate tables", async () => {
    pageMocks.listTaskRuns.mockReturnValue([]);
    pageMocks.listNotifications.mockReturnValue([
      {
        id: "notification-1",
        event_id: "event-12345678",
        revision_id: "revision-1",
        task_run_id: "task-1",
        created_at_ms: Date.UTC(2026, 10, 19, 1),
        category: "FEDERAL_RESERVE_NOTICE",
        summary: "Federal Reserve policy decision",
        market_code: "US",
        published_at_ms: Date.UTC(2026, 10, 19, 0),
        importance_reason: "Official policy terms changed.",
        importance_rule_id: "POLICY_CHANGE",
        confidence_level: "HIGH",
        supporting_source_count: 2,
        sources: [
          {
            relation: "SUPPORTS",
            source_record_id: "record-fed-1",
            canonical_url: "https://www.federalreserve.gov/press.htm",
            published_at_ms: Date.UTC(2026, 10, 19, 0),
            collected_at_ms: Date.UTC(2026, 10, 19, 0, 1),
            source_key: "federalreserve.rss",
            publisher: "Federal Reserve",
            authority_role: "REGULATORY_PRIMARY",
            license_status: "VERIFIED",
          },
        ],
      },
    ]);
    pageMocks.listNotificationDecisions.mockReturnValue([
      {
        id: "decision-1",
        task_run_id: "task-1",
        event_id: "event-12345678",
        revision_id: "revision-1",
        outcome: "SELECTED",
        reason_code: "NEW_MAJOR_EVENT",
        rule_version: "p11-03-v1",
        importance_rule_id: "POLICY_CHANGE",
        confidence_level: "HIGH",
        supporting_source_count: 2,
        priority_rank: 1,
        open_market_priority: 1,
        priority_source_count: 2,
        priority_published_at_ms: Date.UTC(2026, 10, 19, 0),
        priority_details_json: "{}",
        decided_at_ms: Date.UTC(2026, 10, 19, 1),
        summary: "Federal Reserve policy decision",
        market_code: "US",
        sources: [
          {
            relation: "SUPPORTS",
            source_record_id: "record-fed-1",
            canonical_url: "https://www.federalreserve.gov/press.htm",
            published_at_ms: Date.UTC(2026, 10, 19, 0),
            collected_at_ms: Date.UTC(2026, 10, 19, 0, 1),
            source_key: "federalreserve.rss",
            publisher: "Federal Reserve",
            authority_role: "REGULATORY_PRIMARY",
            license_status: "VERIFIED",
          },
        ],
      },
    ]);

    const page = await TasksPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("Federal Reserve policy decision");
    expect(html).toContain("2 个独立来源");
    expect(html).toContain('href="https://www.federalreserve.gov/press.htm"');
    expect(html).toContain("许可已核验");
    expect(html).toContain("发布");
    expect(html).toContain("收录");
    expect(html).toContain("第 1 位");
    expect(html).toContain("市场开市优先");
    expect(html).toContain("task-1");
    expect(html).toContain("符合已核验来源与重大性规则");
    expect(html).toContain("p11-03-v1");
    expect(html).toContain("任务队列");
  });

  it("shows a shadcn alert when a scan request could not be queued", async () => {
    pageMocks.listTaskRuns.mockReturnValue([]);
    pageMocks.listNotifications.mockReturnValue([]);
    pageMocks.listNotificationDecisions.mockReturnValue([]);

    const page = await TasksPage({
      searchParams: Promise.resolve({ marketWatch: "error" }),
    });
    const html = renderToStaticMarkup(createElement(() => page));

    expect(html).toContain("市场扫描任务未加入队列");
    expect(html).toContain('role="alert"');
  });
});
