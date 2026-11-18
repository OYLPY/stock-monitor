import { describe, expect, it } from "vitest";

import {
  SCORING_DIMENSIONS,
  scoreValidation,
} from "@/features/validation/scoring";
import type { ScoringInput, ScoringRule } from "@/features/validation/scoring";

const HASH = "a".repeat(64);
type TestEvidence = NonNullable<
  NonNullable<ScoringInput["evidence"]>["afterCostReturn"]
>;
type CompleteScoringInput = ScoringInput & {
  evidence: NonNullable<ScoringInput["evidence"]>;
  rule: ScoringRule;
};

function testRubric(
  resultClass: "VERIFIED" | "NOT_VERIFIED" | "DEMO_ONLY" = "VERIFIED",
): ScoringRule {
  const dataClass = resultClass === "DEMO_ONLY" ? "FIXTURE" : "HISTORICAL";
  return {
    calibration: {
      dataClass,
      evidenceHashSha256: HASH,
      resultClass,
      sourceRecordIds: ["test:rubric-calibration"],
    },
    id: "test-rubric",
    thresholds: {
      afterCostReturn: [0, 50, 100, 150],
      crossEnvironmentRobustness: [0.2, 0.4, 0.6, 0.8],
      executionFeasibility: [0.2, 0.4, 0.6, 0.8],
      maxDrawdown: [1_000, 2_000, 3_000, 4_000],
      outOfSampleStability: [0.2, 0.4, 0.6, 0.8],
    },
    version: "test-rubric-v1",
  };
}

function metricEvidenceStub(
  value: number,
  resultClass: "VERIFIED" | "NOT_VERIFIED" | "DEMO_ONLY" = "VERIFIED",
): TestEvidence {
  return {
    dataClass: resultClass === "DEMO_ONLY" ? "FIXTURE" : "HISTORICAL",
    evidenceHashSha256: HASH,
    resultClass,
    sourceRecordIds: ["test:result-source"],
    value,
  };
}

function input(): CompleteScoringInput {
  return {
    evidence: {
      afterCostReturn: metricEvidenceStub(100),
      crossEnvironmentRobustness: metricEvidenceStub(0.2),
      executionFeasibility: metricEvidenceStub(0.4),
      maxDrawdown: metricEvidenceStub(2_000),
      outOfSampleStability: metricEvidenceStub(1),
    },
    rule: testRubric(),
  };
}

describe("scoreValidation", () => {
  it("scores exact band boundaries and marks 18/25 as a risk-review candidate only", () => {
    const report = scoreValidation(input());

    expect(report.totalScore).toBe(18);
    expect(report.classification).toBe(
      "VALIDATION_CANDIDATE_PENDING_RISK_REVIEW",
    );
    expect(report.resultClass).toBe("VERIFIED");
    expect(report.dimensions.maxDrawdown.score).toBe(4);
    expect(report.dimensions.maxDrawdown.dataClass).toBe("HISTORICAL");
    expect(report.ruleCalibration?.sourceRecordIds).toEqual([
      "test:rubric-calibration",
    ]);
    expect(report.ruleHashSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.inputHashSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps available dimension scores but withholds the total when one dimension is missing", () => {
    const request = input();
    delete request.evidence.maxDrawdown;

    const report = scoreValidation(request);

    expect(report.dimensions.maxDrawdown).toMatchObject({
      reasonCode: "MISSING_EVIDENCE",
      score: null,
    });
    expect(report.dimensions.afterCostReturn.score).toBe(4);
    expect(report.totalScore).toBeNull();
    expect(report.classification).toBe("NOT_VERIFIED");
  });

  it("returns NOT_VERIFIED when no calibrated scoring rule is available", () => {
    const report = scoreValidation({ evidence: input().evidence });

    expect(report.totalScore).toBeNull();
    expect(report.ruleHashSha256).toBeNull();
    expect(report.dimensions.afterCostReturn.score).toBeNull();
    expect(report.dimensions.afterCostReturn.reasonCode).toBe("NOT_VERIFIED");
    expect(report.classification).toBe("NOT_VERIFIED");
  });

  it("withholds scores when a caller's pinned rule hash does not match", () => {
    const report = scoreValidation({
      ...input(),
      expectedRuleHashSha256: "b".repeat(64),
    });

    expect(report.totalScore).toBeNull();
    expect(report.dimensions.afterCostReturn.reasonCode).toBe(
      "RULE_VERSION_MISMATCH",
    );
    expect(report.classification).toBe("NOT_VERIFIED");
  });

  it("never upgrades fixture-derived evidence to a validation candidate", () => {
    const request = input();
    request.rule = testRubric("DEMO_ONLY");
    for (const dimension of SCORING_DIMENSIONS) {
      const item = request.evidence[dimension];
      if (item)
        request.evidence[dimension] = metricEvidenceStub(
          item.value,
          "DEMO_ONLY",
        );
    }

    const report = scoreValidation(request);

    expect(report.totalScore).toBe(18);
    expect(report.resultClass).toBe("DEMO_ONLY");
    expect(report.classification).toBe("DEMO_ONLY");
  });

  it("rejects uncalibrated thresholds and withholds scores from unverified evidence", () => {
    const invalidRule = input();
    invalidRule.rule.thresholds.afterCostReturn = [150, 100, 50, 0];
    expect(() => scoreValidation(invalidRule)).toThrow();

    const impossibleRatioBands = input();
    impossibleRatioBands.rule.thresholds.outOfSampleStability = [
      -0.1, 0, 0.5, 1,
    ];
    expect(() => scoreValidation(impossibleRatioBands)).toThrow();

    const unverified = input();
    unverified.evidence.afterCostReturn = metricEvidenceStub(
      100,
      "NOT_VERIFIED",
    );
    const report = scoreValidation(unverified);
    expect(report.dimensions.afterCostReturn.score).toBeNull();
    expect(report.totalScore).toBeNull();
    expect(report.classification).toBe("NOT_VERIFIED");

    const uncalibratedRule = input();
    uncalibratedRule.rule.calibration.resultClass = "NOT_VERIFIED";
    expect(scoreValidation(uncalibratedRule).totalScore).toBeNull();
  });

  it("hashes evidence independently of source-id ordering", () => {
    const first = input();
    const second = input();
    first.evidence.afterCostReturn = {
      ...metricEvidenceStub(100),
      sourceRecordIds: ["source-a", "source-b"],
    };
    second.evidence.afterCostReturn = {
      ...metricEvidenceStub(100),
      sourceRecordIds: ["source-b", "source-a"],
    };

    expect(scoreValidation(first).inputHashSha256).toBe(
      scoreValidation(second).inputHashSha256,
    );
  });
});
