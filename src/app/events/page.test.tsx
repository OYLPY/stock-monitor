import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadEvents = vi.hoisted(() => vi.fn());

vi.mock("@/features/evidence/event-center", () => ({
  loadMarketEvents: loadEvents,
}));

import EventsPage from "@/app/events/page";
import { createTestDatabase } from "@/db/test-database";
import {
  createMarketEvent,
  getMarketEvent,
} from "@/features/evidence/repository";

describe("events page", () => {
  beforeEach(() => loadEvents.mockReset());

  it("filters only by validated market and verification values", async () => {
    const fixture = await createTestDatabase();
    try {
      const japanEvent = createMarketEvent(fixture.database, {
        category: "TEST_EVENT",
        summary: "日本测试事件",
        marketCode: "JP",
        instrument: null,
        occurredAtMs: null,
        publishedAtMs: null,
        importanceReason: "No source is available.",
        dataClass: "NOT_VERIFIED",
        verificationLevel: "NOT_VERIFIED",
        verificationReason: "No source record is available.",
        verificationRuleVersion: null,
        primarySourceRecordId: null,
        evidence: [],
      });
      const usEvent = createMarketEvent(fixture.database, {
        category: "TEST_EVENT",
        summary: "美国测试事件",
        marketCode: "US",
        instrument: null,
        occurredAtMs: null,
        publishedAtMs: null,
        importanceReason: "No source is available.",
        dataClass: "NOT_VERIFIED",
        verificationLevel: "NOT_VERIFIED",
        verificationReason: "No source record is available.",
        verificationRuleVersion: null,
        primarySourceRecordId: null,
        evidence: [],
      });
      loadEvents.mockResolvedValue([
        getMarketEvent(fixture.database, japanEvent.id),
        getMarketEvent(fixture.database, usEvent.id),
      ]);

      const page = await EventsPage({
        searchParams: Promise.resolve({
          market: "JP",
          verification: "NOT_VERIFIED",
        }),
      });
      const html = renderToStaticMarkup(createElement(() => page));

      expect(html).toContain("日本测试事件");
      expect(html).not.toContain("美国测试事件");
      expect(html).toContain("显示 1 / 2 条");

      const verifiedPage = await EventsPage({
        searchParams: Promise.resolve({
          market: "JP",
          verification: "VERIFIED",
        }),
      });
      const verifiedHtml = renderToStaticMarkup(
        createElement(() => verifiedPage),
      );
      expect(verifiedHtml).not.toContain("日本测试事件");
      expect(verifiedHtml).toContain("显示 0 / 2 条");
    } finally {
      await fixture.cleanup();
    }
  });
});
