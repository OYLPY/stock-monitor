import { describe, expect, it } from "vitest";
import {
  renderContextEvaluation,
  runContextEvaluation,
} from "./context-evaluation";

describe("P08-05 offline context evaluation", () => {
  it("preserves issue and risk markers, rejects unknown citations, and repeats deterministically", async () => {
    const report = await runContextEvaluation();
    const requiredMarkers = report.requiredMarkerCount;
    const { fullHistoryFixture, projectTaskRestart, sacFixture } = report.modes;

    expect(report.repeats.count).toBe(3);
    expect(report.repeats.distinctResults).toBe(1);
    expect(fullHistoryFixture.retainedMarkers).toEqual([requiredMarkers]);
    expect(projectTaskRestart.retainedMarkers).toEqual([requiredMarkers]);
    expect(sacFixture.retainedMarkers).toEqual(
      Array(sacFixture.contextCount).fill(requiredMarkers),
    );
    expect(fullHistoryFixture.peakPayloadBytes).toBeGreaterThan(
      projectTaskRestart.peakPayloadBytes,
    );
    expect(sacFixture.contextCount).toBe(3);
    expect(report.untrustedHistory).toEqual({
      presentInFullHistoryFixture: true,
      omittedFromProjectTaskRestart: true,
      omittedFromEverySacContext: true,
    });
    expect(report.citationAudit).toEqual({
      knownSourceClaims: 1,
      acceptedKnownSourceClaims: 1,
      unknownSourceClaims: 1,
      rejectedUnknownSourceClaims: 1,
      semanticTruth: "NOT_MEASURED",
    });
    expect(report.modelCalls).toBe(0);
    expect(report.tokenCounts).toBe("NOT_MEASURED");
    expect(renderContextEvaluation(report)).toContain("FIXTURE_ONLY");
  });
});
