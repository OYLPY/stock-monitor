import { createHash } from "node:crypto";

import type { ZodNumber } from "zod";
import { z } from "zod";

const ENGINE_VERSION = "validation-scoring-v1";
const CANDIDATE_SCORE = 18;
const SHA256 = /^[a-f0-9]{64}$/;

export const SCORING_DIMENSIONS = [
  "outOfSampleStability",
  "afterCostReturn",
  "maxDrawdown",
  "executionFeasibility",
  "crossEnvironmentRobustness",
] as const;

type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

const DIMENSION_CONTRACTS = {
  outOfSampleStability: {
    direction: "HIGHER_IS_BETTER",
    metric: "positiveFoldRatio",
    unit: "ratio",
  },
  afterCostReturn: {
    direction: "HIGHER_IS_BETTER",
    metric: "meanNetReturnBps",
    unit: "bps",
  },
  maxDrawdown: {
    direction: "LOWER_IS_BETTER",
    metric: "maxDrawdownBps",
    unit: "bps",
  },
  executionFeasibility: {
    direction: "HIGHER_IS_BETTER",
    metric: "fillRatio",
    unit: "ratio",
  },
  crossEnvironmentRobustness: {
    direction: "HIGHER_IS_BETTER",
    metric: "positiveEnvironmentRatio",
    unit: "ratio",
  },
} as const satisfies Record<
  ScoringDimension,
  {
    direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
    metric: string;
    unit: string;
  }
>;

const dataClassSchema = z.enum([
  "REAL",
  "DELAYED",
  "HISTORICAL",
  "FIXTURE",
  "NOT_VERIFIED",
]);
const resultClassSchema = z.enum(["VERIFIED", "NOT_VERIFIED", "DEMO_ONLY"]);
const sourceRecordIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length);
const evidenceMetadataSchema = z.strictObject({
  dataClass: dataClassSchema,
  evidenceHashSha256: z.string().regex(SHA256),
  resultClass: resultClassSchema,
  sourceRecordIds: sourceRecordIdsSchema,
});
const ratioSchema = z.number().finite().min(0).max(1);
const metricEvidenceSchema = (value: ZodNumber) =>
  evidenceMetadataSchema.extend({ value });
function ascendingThresholdsSchema(value: ZodNumber) {
  return z
    .tuple([value, value, value, value])
    .refine(
      ([first, second, third, fourth]) =>
        first < second && second < third && third < fourth,
    );
}

const returnThresholdsSchema = ascendingThresholdsSchema(z.number().finite());
const ratioThresholdsSchema = ascendingThresholdsSchema(
  z.number().finite().min(0).max(1),
);
const drawdownThresholdsSchema = ascendingThresholdsSchema(
  z.number().finite().min(0).max(10_000),
);

const scoringRuleSchema = z.strictObject({
  calibration: evidenceMetadataSchema,
  id: z.string().trim().min(1),
  thresholds: z.strictObject({
    afterCostReturn: returnThresholdsSchema,
    crossEnvironmentRobustness: ratioThresholdsSchema,
    executionFeasibility: ratioThresholdsSchema,
    maxDrawdown: drawdownThresholdsSchema,
    outOfSampleStability: ratioThresholdsSchema,
  }),
  version: z.string().trim().min(1),
});

const scoringEvidenceSchema = z.strictObject({
  afterCostReturn: metricEvidenceSchema(z.number().finite()).optional(),
  crossEnvironmentRobustness: metricEvidenceSchema(ratioSchema).optional(),
  executionFeasibility: metricEvidenceSchema(ratioSchema).optional(),
  maxDrawdown: metricEvidenceSchema(
    z.number().finite().min(0).max(10_000),
  ).optional(),
  outOfSampleStability: metricEvidenceSchema(ratioSchema).optional(),
});

const scoringInputSchema = z.strictObject({
  evidence: scoringEvidenceSchema.optional(),
  expectedRuleHashSha256: z.string().regex(SHA256).optional(),
  rule: scoringRuleSchema.optional(),
});

export type ScoringRule = z.input<typeof scoringRuleSchema>;
export type ScoringInput = {
  evidence?: z.input<typeof scoringEvidenceSchema>;
  expectedRuleHashSha256?: string;
  rule?: ScoringRule;
};
type MetricEvidence = z.infer<typeof evidenceMetadataSchema> & {
  value: number;
};
type EvidenceProvenance = Readonly<{
  dataClass: z.infer<typeof dataClassSchema>;
  evidenceHashSha256: string;
  resultClass: z.infer<typeof resultClassSchema>;
  sourceRecordIds: readonly string[];
}>;

type DimensionReason =
  "DEMO_ONLY" | "MISSING_EVIDENCE" | "NOT_VERIFIED" | "RULE_VERSION_MISMATCH";

export type ScoringDimensionResult = Readonly<{
  dataClass: EvidenceProvenance["dataClass"] | null;
  direction: (typeof DIMENSION_CONTRACTS)[ScoringDimension]["direction"];
  evidenceHashSha256: string | null;
  metric: (typeof DIMENSION_CONTRACTS)[ScoringDimension]["metric"];
  reasonCode: DimensionReason | null;
  resultClass: EvidenceProvenance["resultClass"] | null;
  score: number | null;
  sourceRecordIds: readonly string[];
  unit: (typeof DIMENSION_CONTRACTS)[ScoringDimension]["unit"];
  value: number | null;
}>;

export type ValidationScoringReport = Readonly<{
  classification:
    | "BELOW_CANDIDATE_THRESHOLD"
    | "DEMO_ONLY"
    | "NOT_VERIFIED"
    | "VALIDATION_CANDIDATE_PENDING_RISK_REVIEW";
  dimensions: Readonly<Record<ScoringDimension, ScoringDimensionResult>>;
  engineVersion: typeof ENGINE_VERSION;
  expectedRuleHashSha256: string | null;
  inputHashSha256: string;
  resultClass: "DEMO_ONLY" | "NOT_VERIFIED" | "VERIFIED";
  ruleCalibration: EvidenceProvenance | null;
  ruleHashSha256: string | null;
  ruleId: string | null;
  ruleVersion: string | null;
  totalScore: number | null;
}>;

function sha256(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

function sortedSourceIds(sourceRecordIds: readonly string[]): string[] {
  return [...sourceRecordIds].sort();
}

function hashRule(rule: ScoringRule): string {
  return sha256(
    JSON.stringify([
      ENGINE_VERSION,
      rule.id,
      rule.version,
      [
        rule.calibration.dataClass,
        rule.calibration.resultClass,
        sortedSourceIds(rule.calibration.sourceRecordIds),
        rule.calibration.evidenceHashSha256,
      ],
      SCORING_DIMENSIONS.map((dimension) => rule.thresholds[dimension]),
    ]),
  );
}

function isDemoEvidence(evidence: {
  dataClass: z.infer<typeof dataClassSchema>;
  resultClass: z.infer<typeof resultClassSchema>;
}): boolean {
  return (
    evidence.dataClass === "FIXTURE" || evidence.resultClass === "DEMO_ONLY"
  );
}

function isUsableEvidence(evidence: {
  dataClass: z.infer<typeof dataClassSchema>;
  resultClass: z.infer<typeof resultClassSchema>;
}): boolean {
  return (
    evidence.resultClass !== "NOT_VERIFIED" &&
    (evidence.dataClass === "HISTORICAL" || evidence.dataClass === "FIXTURE")
  );
}

function scoreValue(
  dimension: ScoringDimension,
  value: number,
  thresholds: readonly number[],
) {
  const { direction } = DIMENSION_CONTRACTS[dimension];
  const metBands = thresholds.filter((threshold) =>
    direction === "HIGHER_IS_BETTER" ? value >= threshold : value <= threshold,
  ).length;
  return metBands + 1;
}

function scoreDimension(
  dimension: ScoringDimension,
  item: MetricEvidence | undefined,
  rule: ScoringRule | undefined,
  ruleUsable: boolean,
  ruleIsDemo: boolean,
  ruleMatches: boolean,
): ScoringDimensionResult {
  const score =
    item !== undefined &&
    rule !== undefined &&
    ruleUsable &&
    isUsableEvidence(item)
      ? scoreValue(dimension, item.value, rule.thresholds[dimension])
      : null;
  const usable = score !== null;
  return {
    dataClass: item?.dataClass ?? null,
    direction: DIMENSION_CONTRACTS[dimension].direction,
    evidenceHashSha256: item?.evidenceHashSha256 ?? null,
    metric: DIMENSION_CONTRACTS[dimension].metric,
    reasonCode:
      item === undefined
        ? "MISSING_EVIDENCE"
        : !ruleMatches
          ? "RULE_VERSION_MISMATCH"
          : !usable
            ? "NOT_VERIFIED"
            : isDemoEvidence(item) || ruleIsDemo
              ? "DEMO_ONLY"
              : null,
    resultClass: item?.resultClass ?? null,
    score,
    sourceRecordIds: item ? sortedSourceIds(item.sourceRecordIds) : [],
    unit: DIMENSION_CONTRACTS[dimension].unit,
    value: item?.value ?? null,
  };
}

export function scoreValidation(input: ScoringInput): ValidationScoringReport {
  const parsed = scoringInputSchema.parse(input);
  const evidence = parsed.evidence ?? {};
  const rule = parsed.rule;
  const ruleHashSha256 = rule ? hashRule(rule) : null;
  const expectedRuleHashSha256 = parsed.expectedRuleHashSha256 ?? null;
  const ruleMatches =
    expectedRuleHashSha256 === null ||
    (rule !== undefined && expectedRuleHashSha256 === ruleHashSha256);
  const ruleUsable =
    ruleMatches && rule !== undefined && isUsableEvidence(rule.calibration);
  const ruleIsDemo = rule !== undefined && isDemoEvidence(rule.calibration);
  const dimensions = {
    afterCostReturn: scoreDimension(
      "afterCostReturn",
      evidence.afterCostReturn,
      rule,
      ruleUsable,
      ruleIsDemo,
      ruleMatches,
    ),
    crossEnvironmentRobustness: scoreDimension(
      "crossEnvironmentRobustness",
      evidence.crossEnvironmentRobustness,
      rule,
      ruleUsable,
      ruleIsDemo,
      ruleMatches,
    ),
    executionFeasibility: scoreDimension(
      "executionFeasibility",
      evidence.executionFeasibility,
      rule,
      ruleUsable,
      ruleIsDemo,
      ruleMatches,
    ),
    maxDrawdown: scoreDimension(
      "maxDrawdown",
      evidence.maxDrawdown,
      rule,
      ruleUsable,
      ruleIsDemo,
      ruleMatches,
    ),
    outOfSampleStability: scoreDimension(
      "outOfSampleStability",
      evidence.outOfSampleStability,
      rule,
      ruleUsable,
      ruleIsDemo,
      ruleMatches,
    ),
  } satisfies Record<ScoringDimension, ScoringDimensionResult>;
  const allDimensionsScored = SCORING_DIMENSIONS.every(
    (dimension) => dimensions[dimension].score !== null,
  );
  const hasDemoEvidence =
    ruleIsDemo ||
    SCORING_DIMENSIONS.some((dimension) => {
      const item = evidence[dimension];
      return item !== undefined && isDemoEvidence(item);
    });
  const resultClass = hasDemoEvidence
    ? "DEMO_ONLY"
    : allDimensionsScored
      ? "VERIFIED"
      : "NOT_VERIFIED";
  const totalScore = allDimensionsScored
    ? SCORING_DIMENSIONS.reduce(
        (total, dimension) => total + (dimensions[dimension].score ?? 0),
        0,
      )
    : null;
  const classification =
    resultClass === "DEMO_ONLY"
      ? "DEMO_ONLY"
      : resultClass !== "VERIFIED" || totalScore === null
        ? "NOT_VERIFIED"
        : totalScore >= CANDIDATE_SCORE
          ? "VALIDATION_CANDIDATE_PENDING_RISK_REVIEW"
          : "BELOW_CANDIDATE_THRESHOLD";
  const inputHashSha256 = sha256(
    JSON.stringify([
      ruleHashSha256,
      expectedRuleHashSha256,
      SCORING_DIMENSIONS.map((dimension) => {
        const item = evidence[dimension];
        return item
          ? [
              item.value,
              item.dataClass,
              item.resultClass,
              item.evidenceHashSha256,
              sortedSourceIds(item.sourceRecordIds),
            ]
          : null;
      }),
    ]),
  );

  return {
    classification,
    dimensions,
    engineVersion: ENGINE_VERSION,
    inputHashSha256,
    resultClass,
    expectedRuleHashSha256,
    ruleCalibration: rule
      ? {
          dataClass: rule.calibration.dataClass,
          evidenceHashSha256: rule.calibration.evidenceHashSha256,
          resultClass: rule.calibration.resultClass,
          sourceRecordIds: sortedSourceIds(rule.calibration.sourceRecordIds),
        }
      : null,
    ruleHashSha256,
    ruleId: rule?.id ?? null,
    ruleVersion: rule?.version ?? null,
    totalScore,
  };
}
