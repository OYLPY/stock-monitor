import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shadcn/collapsible", async () => {
  const React = await import("react");
  const Content = ({ children }: { children: ReactNode }) =>
    React.createElement("div", null, children);
  const Trigger = ({ children }: { children: ReactNode }) =>
    React.createElement("button", { type: "button" }, children);

  return {
    Collapsible: Content,
    CollapsibleContent: Content,
    CollapsibleTrigger: Trigger,
  };
});

import { EventCenter } from "@/components/events/event-center";
import { createTestDatabase } from "@/db/test-database";
import {
  appendSourceRecord,
  createMarketEvent,
  getMarketEvent,
  registerSource,
} from "@/features/evidence/repository";

describe("event center", () => {
  it("shows fixture evidence as demo-only and keeps missing assessments unknown", async () => {
    const fixture = await createTestDatabase();
    try {
      const source = registerSource(fixture.database, {
        sourceKey: "test.fixture",
        publisher: "合成测试来源",
        sourceType: "OTHER",
        authorityRole: "FIXTURE",
        referenceUrl: "https://example.com/fixture",
        licenseUrl: null,
        licenseStatus: "UNKNOWN",
        credentialRequirement: "NOT_REQUIRED",
      });
      const record = appendSourceRecord(fixture.database, {
        sourceId: source.id,
        recordKey: "event:test-001",
        recordType: "NEWS",
        recordVersion: 1,
        supersedesRecordId: null,
        publishedAtMs: 1_794_096_000_000,
        occurredAtMs: 1_794_096_000_000,
        availableAtMs: null,
        rawTimeText: "synthetic time",
        sourceTimeZone: "Asia/Tokyo",
        canonicalUrl: "https://example.com/fixture/event-001",
        dataClass: "FIXTURE",
        content: "synthetic event evidence",
      });
      const duplicateRecord = appendSourceRecord(fixture.database, {
        sourceId: source.id,
        recordKey: "event:test-002",
        recordType: "NEWS",
        recordVersion: 1,
        supersedesRecordId: null,
        publishedAtMs: 1_794_096_000_000,
        occurredAtMs: 1_794_096_000_000,
        availableAtMs: null,
        rawTimeText: "synthetic duplicate time",
        sourceTimeZone: "Asia/Tokyo",
        canonicalUrl: "https://example.com/fixture/event-002",
        dataClass: "FIXTURE",
        content: "synthetic duplicate event evidence",
      });
      const event = createMarketEvent(fixture.database, {
        category: "TEST_EVENT",
        summary: "合成事件标题",
        marketCode: "JP",
        instrument: null,
        occurredAtMs: 1_794_096_000_000,
        publishedAtMs: 1_794_096_000_000,
        importanceReason: "仅供页面验收使用。",
        dataClass: "FIXTURE",
        verificationLevel: "DEMO_ONLY",
        verificationReason: "Synthetic test fixture.",
        verificationRuleVersion: null,
        primarySourceRecordId: null,
        evidence: [
          { sourceRecordId: record.id, relation: "SUPPORTS" },
          { sourceRecordId: duplicateRecord.id, relation: "CONTEXT" },
        ],
      });
      const persisted = getMarketEvent(fixture.database, event.id);
      const html = renderToStaticMarkup(
        createElement(EventCenter, {
          events: persisted ? [persisted] : [],
          filters: { market: "", verification: "" },
          totalEvents: 1,
        }),
      );

      expect(html).toContain("异常与事件");
      expect(html).toContain("合成事件标题");
      expect(html).toContain("仅演示");
      expect(html).toContain("重要性等级");
      expect(html).toContain("尚未分级");
      expect(html).toContain("尚无已保存的风险裁决记录");
      expect(html).toContain("无法判断是否符合新发现和高重要性条件");
      expect(html).toContain("修订与来源证据（1 条修订）");
      expect(html).toContain("合成测试来源");
      expect(html).toContain("测试/演示来源");
      expect(html).toContain("许可未知");
      expect(html).toContain('href="https://example.com/fixture/event-001"');
      expect(html).toContain('href="https://example.com/fixture/event-002"');
      expect(html).not.toContain(">已验证</span>");
    } finally {
      await fixture.cleanup();
    }
  });

  it("distinguishes an empty local event store from a filter with no matches", () => {
    const emptyStore = renderToStaticMarkup(
      createElement(EventCenter, {
        events: [],
        filters: { market: "", verification: "" },
        totalEvents: 0,
      }),
    );
    const noMatches = renderToStaticMarkup(
      createElement(EventCenter, {
        events: [],
        filters: { market: "JP", verification: "" },
        totalEvents: 2,
      }),
    );

    expect(emptyStore).toContain("空列表不表示市场没有事件");
    expect(noMatches).toContain("没有符合条件的事件");
  });
});
