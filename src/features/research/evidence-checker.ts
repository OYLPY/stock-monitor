import type {
  ResearchModelOutput,
  ResearchReport,
} from "@/features/reports/contract";

export type ResearchEvidenceReference = {
  id: string;
  canonicalUrl: string | null;
  publishedAtMs: number | null;
  occurredAtMs: number | null;
  availableAtMs: number | null;
  collectedAtMs: number;
  timestampInvalid: boolean;
  dataClass: string;
  publisher: string;
  referenceUrl: string | null;
  authorityRole: string;
  licenseStatus: string;
  marketCode: "US" | "JP" | null;
  currencyCodes: ("USD" | "JPY")[];
  units: "share"[];
  text: string[];
};

type RejectionCode =
  ResearchReport["evidenceValidation"]["rejections"][number]["reasons"][number];
type Rejection = ResearchReport["evidenceValidation"]["rejections"][number];

const dataClasses = new Set([
  "REAL",
  "DELAYED",
  "HISTORICAL",
  "FIXTURE",
  "NOT_VERIFIED",
]);

function validHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function storedEvidenceUrl(reference: ResearchEvidenceReference) {
  const urls = [reference.canonicalUrl, reference.referenceUrl].filter(
    (url): url is string => url !== null,
  );
  return urls.find(validHttpsUrl) ?? null;
}

function referenceProblems(
  reference: ResearchEvidenceReference,
  nowMs: number,
): RejectionCode[] {
  const reasons: RejectionCode[] = [];
  if (
    reference.timestampInvalid ||
    !Number.isSafeInteger(reference.collectedAtMs) ||
    reference.collectedAtMs < 0
  ) {
    reasons.push("SOURCE_TIMESTAMP_INVALID");
  } else {
    if (reference.collectedAtMs > nowMs) {
      reasons.push("SOURCE_TIMESTAMP_FUTURE");
    }
    for (const timestamp of [
      reference.publishedAtMs,
      reference.availableAtMs,
    ]) {
      if (timestamp === null) continue;
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        reasons.push("SOURCE_TIMESTAMP_INVALID");
      } else if (timestamp > nowMs) {
        reasons.push("SOURCE_TIMESTAMP_FUTURE");
      } else if (timestamp > reference.collectedAtMs) {
        reasons.push("SOURCE_TIMESTAMP_AFTER_COLLECTION");
      }
    }
    if (
      reference.occurredAtMs !== null &&
      (!Number.isSafeInteger(reference.occurredAtMs) ||
        reference.occurredAtMs < 0)
    ) {
      reasons.push("SOURCE_TIMESTAMP_INVALID");
    }
  }

  const urls = [reference.canonicalUrl, reference.referenceUrl].filter(
    (url): url is string => url !== null,
  );
  if (urls.some((url) => !validHttpsUrl(url))) {
    reasons.push("SOURCE_URL_INVALID");
  }
  if (!dataClasses.has(reference.dataClass)) {
    reasons.push("SOURCE_DATA_CLASS_INVALID");
  }
  return [...new Set(reasons)];
}

export function isUsableEvidenceReference(
  reference: ResearchEvidenceReference,
  nowMs: number,
) {
  return referenceProblems(reference, nowMs).length === 0;
}

function canonicalNumber(value: string) {
  const number = value.replaceAll(",", "").replace(/%$/, "");
  const [whole, fraction] = number.split(".");
  const normalizedFraction = fraction?.replace(/0+$/, "");
  return `${whole}${normalizedFraction ? `.${normalizedFraction}` : ""}${value.endsWith("%") ? "%" : ""}`;
}

function numericTokens(value: string) {
  return [
    ...value.matchAll(
      /(?<![\p{L}\p{N}_])[-+]?\d[\d,]*(?:\.\d+)?%?(?![\p{L}\p{N}_])/gu,
    ),
  ].map(([token]) => canonicalNumber(token));
}

function unitTokens(value: string) {
  const tokens = new Set<string>();
  if (/\b(?:USD|dollars?)\b|\$|美元/i.test(value)) tokens.add("USD");
  if (/\b(?:JPY|yen)\b|[¥￥]|日元/i.test(value)) tokens.add("JPY");
  if (/\bshares?\b|\bper share\b|股/i.test(value)) tokens.add("share");
  if (/\b(?:bps|basis points?)\b|基点/i.test(value)) tokens.add("basis-point");
  if (/\bpercent(?:age)?\b|百分比|%/i.test(value)) {
    tokens.add("percent");
  }
  return [...tokens];
}

function dateProblems(value: string, referenceText: string, nowMs: number) {
  const reasons: RejectionCode[] = [];
  for (const [date] of value.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)) {
    const parsed = new Date(`${date}T00:00:00.000Z`).getTime();
    if (
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== date
    ) {
      reasons.push("UNSUPPORTED_DATE");
    } else if (!referenceText.includes(date)) {
      reasons.push("UNSUPPORTED_DATE");
      if (parsed > nowMs) reasons.push("FUTURE_DATE");
    }
  }
  return reasons;
}

export function checkResearchEvidence(input: {
  model: ResearchModelOutput;
  references: Map<string, ResearchEvidenceReference>;
  qualifiedInstruments: Map<string, Set<string>>;
  nowMs: number;
}) {
  const rejections: Rejection[] = [];
  const validate = (
    outputPath: string,
    evidenceIds: string[],
    text: string,
    candidate?: { marketCode: "US" | "JP"; symbol: string },
    requireRoleCitation = false,
  ) => {
    const reasons = new Set<RejectionCode>();
    if (evidenceIds.length === 0) {
      reasons.add(
        requireRoleCitation ? "ROLE_MISSING_CITATION" : "MISSING_CITATION",
      );
    }
    const cited = [...new Set(evidenceIds)].map((id) => {
      const reference = input.references.get(id);
      if (!reference) {
        reasons.add("UNKNOWN_SOURCE_ID");
        return null;
      }
      for (const reason of referenceProblems(reference, input.nowMs)) {
        reasons.add(reason);
      }
      return reference;
    });
    const validReferences = cited.filter(
      (reference): reference is ResearchEvidenceReference => reference !== null,
    );
    const referenceText = validReferences
      .flatMap((reference) => reference.text)
      .join(" ");
    const supportedNumbers = new Set(numericTokens(referenceText));
    if (numericTokens(text).some((token) => !supportedNumbers.has(token))) {
      reasons.add("UNSUPPORTED_NUMBER");
    }
    const supportedUnits = new Set(
      validReferences.flatMap((reference) => [
        ...unitTokens(reference.text.join(" ")),
        ...reference.currencyCodes,
        ...reference.units,
      ]),
    );
    if ([...unitTokens(text)].some((unit) => !supportedUnits.has(unit))) {
      reasons.add("UNSUPPORTED_CURRENCY_OR_UNIT");
    }
    for (const reason of dateProblems(text, referenceText, input.nowMs)) {
      reasons.add(reason);
    }
    if (candidate) {
      const key = `${candidate.marketCode}:${candidate.symbol}`;
      const supportedPriceSources = input.qualifiedInstruments.get(key);
      if (!supportedPriceSources) reasons.add("CANDIDATE_SYMBOL_NOT_COVERED");
      else if (!evidenceIds.some((id) => supportedPriceSources.has(id))) {
        reasons.add("CANDIDATE_PRICE_EVIDENCE_MISSING");
      }
    }
    const rejection = [...reasons];
    if (rejection.length > 0) {
      rejections.push({ outputPath, evidenceIds, reasons: rejection });
    }
    return rejection.length === 0;
  };

  const filterStatements = <T extends { text: string; evidenceIds: string[] }>(
    path: string,
    items: T[],
  ) =>
    items.filter((item, index) =>
      validate(`${path}[${index}]`, item.evidenceIds, item.text),
    );
  const facts = filterStatements("facts", input.model.facts);
  const inferences = filterStatements("inferences", input.model.inferences);
  const hypotheses = filterStatements("hypotheses", input.model.hypotheses);
  const candidates = input.model.candidates.filter((candidate, index) =>
    validate(
      `candidates[${index}]`,
      candidate.evidenceIds,
      [
        candidate.logic,
        candidate.trigger,
        candidate.invalidation,
        candidate.opposingCase,
        ...candidate.unresolvedQuestions,
      ]
        .filter((value): value is string => value !== null)
        .join(" "),
      candidate,
    ),
  );
  const roleAudit = Object.fromEntries(
    Object.entries(input.model.roleAudit).map(([key, role]) => {
      if (key === "paperPlanner" || role.status === "SKIPPED") {
        return [key, { status: "SKIPPED", summary: null, evidenceIds: [] }];
      }
      const valid = validate(
        `roleAudit.${key}`,
        role.evidenceIds,
        role.summary ?? "",
        undefined,
        true,
      );
      return [
        key,
        {
          status: valid ? role.status : "SKIPPED",
          summary: valid ? role.summary : "引用证据校验失败，角色输出未采纳。",
          evidenceIds: valid ? role.evidenceIds : [],
        },
      ];
    }),
  ) as ResearchReport["roleAudit"];
  const riskReviewValid = validate(
    "riskOfficerReview",
    input.model.riskOfficerReview.evidenceIds,
    input.model.riskOfficerReview.summary,
    undefined,
    true,
  );
  const riskOfficerReview = riskReviewValid
    ? input.model.riskOfficerReview
    : {
        opinion: "VETO" as const,
        summary: "风险意见引用校验失败；按失败关闭处理。",
        evidenceIds: [],
      };

  return {
    facts,
    inferences,
    hypotheses,
    candidates,
    roleAudit,
    riskOfficerReview,
    evidenceValidation: {
      status: rejections.length > 0 ? ("FAILED" as const) : ("PASSED" as const),
      rejections: rejections.slice(0, 100),
    },
  };
}
