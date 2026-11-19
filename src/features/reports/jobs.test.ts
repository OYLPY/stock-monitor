import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/db/test-database";
import { enqueueScheduledReportJobs } from "./jobs.ts";

describe("scheduled report jobs", () => {
  it("queues Tokyo report slots with stable keys and a rolling next slot", async () => {
    const fixture = await createTestDatabase();
    try {
      const nowMs = Date.UTC(2026, 10, 19, 0, 0);
      const first = enqueueScheduledReportJobs(fixture.database, nowMs);
      const replay = enqueueScheduledReportJobs(
        fixture.database,
        nowMs + 30_000,
      );

      expect(first.map(({ task }) => task.scheduledLocalAt).sort()).toEqual(
        [
          "2026-11-19T07:00:00",
          "2026-11-19T16:00:00",
          "2026-11-20T07:00:00",
          "2026-11-20T16:00:00",
          "2026-11-16T07:30:00",
          "2026-11-23T07:30:00",
        ].sort(),
      );
      expect(first.every(({ created }) => created)).toBe(true);
      expect(replay.every(({ created }) => !created)).toBe(true);
      expect(replay.map(({ task }) => task.id)).toEqual(
        first.map(({ task }) => task.id),
      );
      expect(first.every(({ task }) => task.timeZone === "Asia/Tokyo")).toBe(
        true,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
