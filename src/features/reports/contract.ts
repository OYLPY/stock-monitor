import { z } from "zod";

export const reportTypeSchema = z.enum([
  "MORNING",
  "ANOMALY",
  "DAILY_AUDIT",
  "WEEKLY_AUDIT",
]);

const executionStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "BLOCKED_EXTERNAL",
  "SKIPPED",
]);
const verificationLevelSchema = z.enum([
  "VERIFIED",
  "PARTIAL",
  "NOT_VERIFIED",
  "DEMO_ONLY",
]);
const dataClassSchema = z.enum([
  "REAL",
  "DELAYED",
  "HISTORICAL",
  "FIXTURE",
  "NOT_VERIFIED",
]);
const roleKeySchema = z.enum([
  "coordinator",
  "intelligence",
  "marketStructure",
  "strategyResearch",
  "riskOfficer",
  "paperPlanner",
]);

export const statementSchema = z.strictObject({
  text: z.string().min(1).max(1_000),
  evidenceIds: z.array(z.string().uuid()).max(10),
});

export const candidateSchema = z.strictObject({
  id: z.string().min(1).max(160),
  marketCode: z.enum(["US", "JP"]),
  symbol: z.string().min(1).max(32),
  logic: z.string().min(1).max(1_000),
  trigger: z.string().max(1_000).nullable(),
  invalidation: z.string().max(1_000).nullable(),
  opposingCase: z.string().max(1_000).nullable(),
  evidenceIds: z.array(z.string().uuid()).max(10),
  unresolvedQuestions: z.array(z.string().max(500)).max(10),
});

const roleAuditSchema = z.record(
  roleKeySchema,
  z.strictObject({
    status: executionStatusSchema,
    summary: z.string().max(1_000).nullable(),
    evidenceIds: z.array(z.string().uuid()).max(10),
  }),
);

const sourceCoverageSchema = z.strictObject({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  url: z.string().url().nullable(),
  status: z.enum(["AVAILABLE", "DELAYED", "STALE", "UNAVAILABLE", "UNKNOWN"]),
  dataClass: dataClassSchema,
  marketAtMs: z.number().int().safe().nullable(),
  marketTimeZone: z.string().max(64).nullable(),
  collectedAtMs: z.number().int().safe().nullable(),
  collectedTimeZone: z.string().max(64).nullable(),
  currency: z.string().max(8).nullable(),
  delayStatement: z.string().max(500).nullable(),
  limitation: z.string().max(1_000).nullable(),
  evidenceIds: z.array(z.string().uuid()).max(100),
});

const evidenceRejectionCodeSchema = z.enum([
  "MISSING_CITATION",
  "UNKNOWN_SOURCE_ID",
  "SOURCE_TIMESTAMP_INVALID",
  "SOURCE_TIMESTAMP_FUTURE",
  "SOURCE_TIMESTAMP_AFTER_COLLECTION",
  "SOURCE_URL_INVALID",
  "SOURCE_DATA_CLASS_INVALID",
  "UNSUPPORTED_NUMBER",
  "UNSUPPORTED_CURRENCY_OR_UNIT",
  "UNSUPPORTED_DATE",
  "FUTURE_DATE",
  "CANDIDATE_PRICE_EVIDENCE_MISSING",
  "CANDIDATE_SYMBOL_NOT_COVERED",
  "ROLE_MISSING_CITATION",
]);

const evidenceRejectionSchema = z.strictObject({
  outputPath: z.string().min(1).max(100),
  evidenceIds: z.array(z.string().uuid()).max(10),
  reasons: z.array(evidenceRejectionCodeSchema).min(1).max(10),
});

export const researchReportSchema = z.strictObject({
  id: z.string().min(1).max(160),
  type: reportTypeSchema,
  title: z.string().min(1).max(200),
  generatedAtMs: z.number().int().safe().nullable(),
  asOfMs: z.number().int().safe().nullable(),
  timeZone: z.string().max(64).nullable(),
  executionStatus: executionStatusSchema,
  verificationLevel: verificationLevelSchema,
  dataClass: dataClassSchema,
  resultCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
    .nullable(),
  marketSummary: z.array(statementSchema).max(5),
  facts: z.array(statementSchema).max(30),
  inferences: z.array(statementSchema).max(20),
  hypotheses: z.array(statementSchema).max(20),
  candidates: z.array(candidateSchema).max(3),
  evidenceValidation: z.strictObject({
    status: z.enum(["NOT_RUN", "PASSED", "FAILED"]),
    rejections: z.array(evidenceRejectionSchema).max(100),
  }),
  roleAudit: roleAuditSchema,
  riskVerdict: z
    .strictObject({
      status: z.enum(["APPROVED_FOR_PAPER_REVIEW", "REJECTED", "UNRESOLVED"]),
      reasons: z.array(z.string().max(1_000)).max(20),
    })
    .nullable(),
  riskOfficerReview: z
    .strictObject({
      opinion: z.enum(["VETO", "NO_VETO"]),
      summary: z.string().min(1).max(1_000),
      evidenceIds: z.array(z.string().uuid()).max(10),
    })
    .nullable(),
  ledgerState: z.enum(["INITIALIZED", "NOT_INITIALIZED", "UNAVAILABLE"]),
  ledgerSummary: z.string().max(1_000).nullable(),
  sourceCoverage: z.array(sourceCoverageSchema).max(1_200),
  limitations: z.array(z.string().max(1_000)).max(30),
  finalDecision: z.string().max(1_000).nullable(),
});

const modelStatementSchema = z.strictObject({
  text: z.string().min(1).max(1_000),
  evidenceIds: z.array(z.string().uuid()).min(1).max(10),
});
const modelRoleSchema = z.strictObject({
  status: z.enum(["DONE", "SKIPPED"]),
  summary: z.string().max(1_000).nullable(),
  evidenceIds: z.array(z.string().uuid()).max(10),
});

export const researchModelOutputSchema = z.strictObject({
  facts: z.array(modelStatementSchema).max(30),
  inferences: z.array(modelStatementSchema).max(20),
  hypotheses: z.array(modelStatementSchema).max(20),
  candidates: z
    .array(
      z.strictObject({
        marketCode: z.enum(["US", "JP"]),
        symbol: z.string().min(1).max(32),
        logic: z.string().min(1).max(1_000),
        trigger: z.string().max(1_000).nullable(),
        invalidation: z.string().max(1_000).nullable(),
        opposingCase: z.string().max(1_000).nullable(),
        evidenceIds: z.array(z.string().uuid()).min(1).max(10),
        unresolvedQuestions: z.array(z.string().max(500)).max(10),
      }),
    )
    .max(3),
  roleAudit: z.strictObject({
    coordinator: modelRoleSchema,
    intelligence: modelRoleSchema,
    marketStructure: modelRoleSchema,
    strategyResearch: modelRoleSchema,
    riskOfficer: modelRoleSchema,
    paperPlanner: modelRoleSchema,
  }),
  riskOfficerReview: z.strictObject({
    opinion: z.enum(["VETO", "NO_VETO"]),
    summary: z.string().min(1).max(1_000),
    evidenceIds: z.array(z.string().uuid()).max(10),
  }),
  riskReasons: z.array(z.string().max(1_000)).max(20),
  finalDecision: z.string().min(1).max(1_000),
});

export type ResearchReport = z.infer<typeof researchReportSchema>;
export type ResearchReportType = z.infer<typeof reportTypeSchema>;
export type ResearchModelOutput = z.infer<typeof researchModelOutputSchema>;
export type ResearchRoleKey = z.infer<typeof roleKeySchema>;
