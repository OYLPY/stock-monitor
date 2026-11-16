import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../db/test-database";
import { createMarketEvent } from "./repository";
import { loadMarketEvents } from "./event-center";

describe("event center query", () => {
  it("reads persisted events from the local database and closes its connection", async () => {
    const fixture = await createTestDatabase();
    try {
      const event = createMarketEvent(fixture.database, {
        category: "TEST_EVENT",
        summary: "Stored test event",
        marketCode: "JP",
        instrument: null,
        occurredAtMs: null,
        publishedAtMs: null,
        importanceReason: "The event has no verified source yet.",
        dataClass: "NOT_VERIFIED",
        verificationLevel: "NOT_VERIFIED",
        verificationReason: "No source record is available.",
        verificationRuleVersion: null,
        primarySourceRecordId: null,
        evidence: [],
      });
      fixture.database.client.close();

      const events = await loadMarketEvents(fixture.filePath);

      expect(events).toMatchObject([
        {
          id: event.id,
          revisions: [{ summary: "Stored test event", evidence: [] }],
        },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});
