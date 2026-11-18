import { describe, expect, it } from "vitest";

import { parseFixedDecimal } from "@/domain/primitives";
import { runStressSensitivity } from "@/features/validation/stress-test";
import { replayExpected, replayInput } from "./fixtures/replay-2020-2022";

describe("P12-04 fixed replay vector", () => {
  it("recomputes its cost/FX stress result and keeps synthetic history unverified", () => {
    const report = runStressSensitivity(replayInput);
    const replay = runStressSensitivity(replayInput);
    const scenario = report.scenarios[0];

    expect(report).toEqual(replay);
    expect(report.baseline.backtest.resultClass).toBe("DEMO_ONLY");
    expect({
      baselineInputHashSha256: report.baseline.backtest.inputHashSha256,
      baselineFinalEquity: report.baseline.metrics.finalEquity,
      scenarioHashSha256: scenario?.scenarioHashSha256,
      scenarioFees: scenario?.metrics.fees,
      scenarioFinalEquity: scenario?.metrics.finalEquity,
    }).toEqual(replayExpected);
    expect(scenario?.executionChanged).toBe(false);
    expect(scenario?.metrics.filledOrderCount).toBe(
      report.baseline.metrics.filledOrderCount,
    );
    expect(parseFixedDecimal(scenario!.metrics.fees).mantissa).toBeGreaterThan(
      parseFixedDecimal(report.baseline.metrics.fees).mantissa,
    );
    expect(
      parseFixedDecimal(scenario!.metrics.finalEquity!).mantissa,
    ).toBeLessThan(
      parseFixedDecimal(report.baseline.metrics.finalEquity!).mantissa,
    );
    expect(
      report.baseline.historicalWindows.map(({ year, status, metrics }) => ({
        year,
        status,
        metrics,
      })),
    ).toEqual([
      { year: 2020, status: "NOT_VERIFIED", metrics: null },
      { year: 2022, status: "NOT_VERIFIED", metrics: null },
    ]);
    expect(
      scenario?.historicalWindows.every(
        ({ status, metrics, reasonCodes }) =>
          status === "NOT_VERIFIED" &&
          metrics === null &&
          reasonCodes.includes("FIXTURE_NOT_HISTORICAL_EVIDENCE") &&
          reasonCodes.includes("FX_HISTORY_NOT_VERIFIED"),
      ),
    ).toBe(true);
  });

  it("changes the scenario fingerprint when the FX vector changes", () => {
    const baseline = runStressSensitivity(replayInput);
    const changedInput = {
      ...replayInput,
      fxObservations: replayInput.fxObservations.map((observation, index) =>
        index === 0 ? { ...observation, rate: "0.0068" } : observation,
      ),
    };

    const changed = runStressSensitivity(changedInput);

    expect(changed.scenarios[0]?.scenarioHashSha256).not.toBe(
      baseline.scenarios[0]?.scenarioHashSha256,
    );
    expect(
      changed.scenarios[0]?.historicalWindows.every(
        ({ status, metrics }) => status === "NOT_VERIFIED" && metrics === null,
      ),
    ).toBe(true);
  });
});
