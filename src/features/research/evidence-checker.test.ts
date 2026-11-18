import { describe, expect, it } from "vitest";
import type { ResearchModelOutput } from "@/features/reports/contract";
import {
  checkResearchEvidence,
  type ResearchEvidenceReference,
} from "./evidence-checker";

const nowMs = Date.UTC(2026, 10, 19);
const sourceId = "b1b4f596-0fd3-4db0-9576-951d0ac63a7a";
const unknownSourceId = "f14bbd11-2f40-4983-a8da-3546232d6aaa";

function evidence(
  overrides: Partial<ResearchEvidenceReference> = {},
): ResearchEvidenceReference {
  return {
    id: sourceId,
    canonicalUrl: "https://example.com/market-data/abc",
    publishedAtMs: nowMs - 60_000,
    occurredAtMs: nowMs - 120_000,
    availableAtMs: nowMs - 30_000,
    collectedAtMs: nowMs - 10_000,
    timestampInvalid: false,
    dataClass: "REAL",
    publisher: "Example Market Data",
    referenceUrl: "https://example.com/market-data",
    authorityRole: "AUTHORIZED_VENDOR",
    licenseStatus: "VERIFIED",
    marketCode: "US",
    currencyCodes: ["USD"],
    units: ["share"],
    text: [
      "US ABC 2026-11-18 close=100 currency=USD priceUnit=USD/share volumeUnit=share",
    ],
    ...overrides,
  };
}

function model(
  overrides: Partial<ResearchModelOutput> = {},
): ResearchModelOutput {
  const skippedRole = {
    status: "SKIPPED" as const,
    summary: null,
    evidenceIds: [],
  };
  return {
    facts: [],
    inferences: [],
    hypotheses: [],
    candidates: [],
    roleAudit: {
      coordinator: skippedRole,
      intelligence: skippedRole,
      marketStructure: skippedRole,
      strategyResearch: {
        status: "DONE",
        summary: "Reviewed the stored market record.",
        evidenceIds: [sourceId],
      },
      riskOfficer: skippedRole,
      paperPlanner: skippedRole,
    },
    riskOfficerReview: {
      opinion: "NO_VETO",
      summary: "No cited risk issue in this test fixture.",
      evidenceIds: [sourceId],
    },
    riskReasons: [],
    finalDecision: "Research only.",
    ...overrides,
  };
}

function check(input: {
  model: ResearchModelOutput;
  reference?: ResearchEvidenceReference;
  qualifiedInstruments?: Map<string, Set<string>>;
}) {
  return checkResearchEvidence({
    model: input.model,
    references: input.reference
      ? new Map([[input.reference.id, input.reference]])
      : new Map(),
    qualifiedInstruments: input.qualifiedInstruments ?? new Map(),
    nowMs,
  });
}

describe("checkResearchEvidence", () => {
  it("accepts a sourced fact and a candidate citing that symbol's qualified bar", () => {
    const reference = evidence();
    const result = check({
      reference,
      qualifiedInstruments: new Map([["US:ABC", new Set([sourceId])]]),
      model: model({
        facts: [
          {
            text: "ABC closed at 100 USD/share on 2026-11-18.",
            evidenceIds: [sourceId],
          },
        ],
        candidates: [
          {
            marketCode: "US",
            symbol: "ABC",
            logic: "Price evidence records 100 USD/share.",
            trigger: "Review if ABC remains above 100 USD/share.",
            invalidation: null,
            opposingCase: null,
            evidenceIds: [sourceId],
            unresolvedQuestions: [],
          },
        ],
      }),
    });

    expect(result.facts).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.evidenceValidation).toEqual({
      status: "PASSED",
      rejections: [],
    });
  });

  it("rejects unknown IDs and unsupported numeric or currency claims with reasons", () => {
    const result = check({
      reference: evidence(),
      model: model({
        facts: [
          {
            text: "ABC reached 999 JPY/share.",
            evidenceIds: [unknownSourceId],
          },
        ],
      }),
    });

    expect(result.facts).toEqual([]);
    expect(result.evidenceValidation.status).toBe("FAILED");
    expect(result.evidenceValidation.rejections[0]?.reasons).toEqual(
      expect.arrayContaining([
        "UNKNOWN_SOURCE_ID",
        "UNSUPPORTED_NUMBER",
        "UNSUPPORTED_CURRENCY_OR_UNIT",
      ]),
    );
  });

  it("rejects future timestamps, unsafe URLs, and invalid source classes", () => {
    const result = check({
      reference: evidence({
        canonicalUrl: "javascript:alert(1)",
        publishedAtMs: nowMs + 1,
        dataClass: "LIVE",
      }),
      model: model({
        facts: [{ text: "A stored record exists.", evidenceIds: [sourceId] }],
      }),
    });

    expect(result.facts).toEqual([]);
    expect(result.evidenceValidation.rejections[0]?.reasons).toEqual(
      expect.arrayContaining([
        "SOURCE_TIMESTAMP_FUTURE",
        "SOURCE_URL_INVALID",
        "SOURCE_DATA_CLASS_INVALID",
      ]),
    );
  });

  it("rejects timestamps recorded after collection and unsupported future dates", () => {
    const reference = evidence({
      availableAtMs: nowMs - 5_000,
      collectedAtMs: nowMs - 10_000,
    });
    const result = check({
      reference,
      model: model({
        facts: [
          {
            text: "The event is scheduled for 2026-11-20.",
            evidenceIds: [sourceId],
          },
        ],
      }),
    });

    expect(result.facts).toEqual([]);
    expect(result.evidenceValidation.rejections[0]?.reasons).toEqual(
      expect.arrayContaining([
        "SOURCE_TIMESTAMP_AFTER_COLLECTION",
        "UNSUPPORTED_DATE",
        "FUTURE_DATE",
      ]),
    );
  });

  it("rejects a candidate unless its cited source contains a qualified bar for its market and symbol", () => {
    const result = check({
      reference: evidence(),
      qualifiedInstruments: new Map([["US:OTHER", new Set([sourceId])]]),
      model: model({
        candidates: [
          {
            marketCode: "US",
            symbol: "ABC",
            logic: "Price momentum hypothesis.",
            trigger: null,
            invalidation: null,
            opposingCase: null,
            evidenceIds: [sourceId],
            unresolvedQuestions: [],
          },
        ],
      }),
    });

    expect(result.candidates).toEqual([]);
    expect(result.evidenceValidation.rejections[0]?.reasons).toContain(
      "CANDIDATE_SYMBOL_NOT_COVERED",
    );
  });
});
