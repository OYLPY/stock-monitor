import { createHash, randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { withTransaction, type AppDatabase } from "@/db";
import {
  initialCapitalConfigs,
  instruments,
  paperAccounts,
  paperOrders,
  paperPlanVersions,
  paperPlans,
  planApprovals,
  planInputEvidence,
  riskDecisions,
  sourceRecords,
  sources,
} from "@/db/schema";
import { parseFixedDecimal } from "@/domain/primitives";
import {
  feeMinor,
  paperCostModelSchema,
  priceAtoms,
} from "@/features/paper/cost-model";
import { readPaperLedger } from "@/features/paper/ledger";
import type { PaperCostModel } from "@/features/paper/cost-model";
import {
  createPaperEquitySnapshot,
  equityMarketEvidenceInputSchema,
  isDrawdownLimitReached,
} from "./drawdown";
import {
  evidenceInputSchema,
  getSourceEvidence,
  isTrustedSourceRole,
} from "./evidence";

const maxSqliteInteger = (BigInt(1) << BigInt(63)) - BigInt(1);
const priceScale = 8;
const priceDenominator = BigInt(10) ** BigInt(priceScale);
const bpsDenominator = BigInt(10_000);
const checkerVersion = "risk-checker-v1";
const decimalSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const integerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((value) => BigInt(value) <= maxSqliteInteger);
const positiveIntegerStringSchema = integerStringSchema.refine(
  (value) => BigInt(value) > BigInt(0),
);
const timestampSchema = z.number().int().nonnegative().safe();
const planInputSchema = z
  .strictObject({
    candidate: z.strictObject({
      candidateId: z.string().trim().min(1).max(120),
      summary: z.string().trim().min(1).max(4_000),
      evidenceRecordIds: z.array(z.uuid()).max(100),
    }),
    instrumentId: z.uuid(),
    requestedQuantityShares: positiveIntegerStringSchema,
    stopReferencePrice: decimalSchema,
    classificationEvidence: evidenceInputSchema,
    quoteEvidence: evidenceInputSchema,
    riskModelEvidence: evidenceInputSchema,
    fxEvidence: evidenceInputSchema,
    equityEvidence: z
      .array(equityMarketEvidenceInputSchema)
      .max(100)
      .default([]),
  })
  .superRefine(({ candidate }, context) => {
    if (
      new Set(candidate.evidenceRecordIds).size !==
      candidate.evidenceRecordIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidate", "evidenceRecordIds"],
        message: "candidate_evidence_ids_must_be_unique",
      });
    }
  });

type PlanInput = z.infer<typeof planInputSchema>;
type Verdict = "PASS" | "REJECT" | "UNRESOLVED";
type Assessment = {
  status: Verdict;
  reasonCodes: string[];
  requestedQuantityShares: bigint;
  maxAllowedQuantityShares: bigint | null;
  equityMinor: bigint | null;
  riskBudgetMinor: bigint | null;
  plannedLossJpyMinor: bigint | null;
  availableCash: Record<string, string>;
  calculation: Record<string, unknown>;
  ruleVersion: string;
};

const classificationPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instrumentId: z.uuid(),
  marketCode: z.enum(["JP", "US"]),
  assetClass: z.enum(["COMMON_STOCK", "NON_LEVERAGED_ETF"]),
  quoteCurrencyCode: z.enum(["JPY", "USD"]),
  tradingUnit: positiveIntegerStringSchema,
  validFromMs: timestampSchema,
  validUntilMs: timestampSchema,
});

const quotePayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instrumentId: z.uuid(),
  currencyCode: z.enum(["JPY", "USD"]),
  price: decimalSchema,
  marketAtMs: timestampSchema,
  validFromMs: timestampSchema,
  validUntilMs: timestampSchema,
});

const fxPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baseCurrency: z.literal("USD"),
  quoteCurrency: z.literal("JPY"),
  rate: decimalSchema,
  marketAtMs: timestampSchema,
  validFromMs: timestampSchema,
  validUntilMs: timestampSchema,
});

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown) {
  return hash(JSON.stringify(value));
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  return numerator === BigInt(0)
    ? BigInt(0)
    : (numerator + denominator - BigInt(1)) / denominator;
}

function ceilToTick(value: bigint, tick: bigint) {
  return ceilDivide(value, tick) * tick;
}

function floorToTick(value: bigint, tick: bigint) {
  return (value / tick) * tick;
}

function adverseBps(value: bigint, bps: number, tick: bigint) {
  return ceilToTick(ceilDivide(value * BigInt(bps), bpsDenominator), tick);
}

function priceLossMinor(
  priceDifferenceAtoms: bigint,
  shares: bigint,
  currency: "JPY" | "USD",
) {
  const currencyScale = currency === "JPY" ? BigInt(0) : BigInt(2);
  return ceilDivide(
    priceDifferenceAtoms * shares * BigInt(10) ** currencyScale,
    priceDenominator,
  );
}

function convertedRiskJpyMinor(
  amountMinor: bigint,
  currency: "JPY" | "USD",
  rate: string | null,
  model: PaperCostModel,
) {
  if (currency === "JPY") return amountMinor;
  if (!rate) return null;
  const parsedRate = parseFixedDecimal(rate);
  const numerator =
    amountMinor *
    parsedRate.mantissa *
    (bpsDenominator + BigInt(model.fxShockBps));
  const denominator =
    BigInt(100) * BigInt(10) ** BigInt(parsedRate.scale) * bpsDenominator;
  const converted = ceilDivide(numerator, denominator);
  return (
    converted +
    ceilDivide(converted * BigInt(model.fxConversionFeeBps), bpsDenominator)
  );
}

function feeAndPriceRiskJpyMinor(
  shares: bigint,
  priceDifferenceAtoms: bigint,
  currency: "JPY" | "USD",
  rate: string | null,
  model: PaperCostModel,
) {
  const nativeRisk =
    priceLossMinor(priceDifferenceAtoms, shares, currency) +
    feeMinor(model.entryFee, shares) +
    feeMinor(model.exitFee, shares);
  return convertedRiskJpyMinor(nativeRisk, currency, rate, model);
}

function buyCommitmentMinor(
  shares: bigint,
  entryPriceAtoms: bigint,
  currency: "JPY" | "USD",
  fee: PaperCostModel["entryFee"],
) {
  return (
    priceLossMinor(entryPriceAtoms, shares, currency) + feeMinor(fee, shares)
  );
}

function maxLotQuantity(lotSize: bigint, fits: (shares: bigint) => boolean) {
  let low = BigInt(0);
  let high = maxSqliteInteger / lotSize;
  while (low < high) {
    const middle = (low + high + BigInt(1)) / BigInt(2);
    if (fits(middle * lotSize)) low = middle;
    else high = middle - BigInt(1);
  }
  return low * lotSize;
}

function unavailable(
  input: PlanInput,
  reasonCode: string,
  calculation: Record<string, unknown> = {},
  availableCash: Record<string, string> = { JPY: "0", USD: "0" },
  ruleVersion = checkerVersion,
): Assessment {
  return {
    status: "UNRESOLVED",
    reasonCodes: [reasonCode],
    requestedQuantityShares: BigInt(input.requestedQuantityShares),
    maxAllowedQuantityShares: null,
    equityMinor: null,
    riskBudgetMinor: null,
    plannedLossJpyMinor: null,
    availableCash,
    calculation,
    ruleVersion,
  };
}

function parsePayload<T>(content: string, schema: z.ZodType<T>) {
  try {
    const parsed = schema.safeParse(JSON.parse(content) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function validPeriod(validFromMs: number, validUntilMs: number, nowMs: bigint) {
  return (
    BigInt(validFromMs) <= nowMs &&
    nowMs <= BigInt(validUntilMs) &&
    validUntilMs >= validFromMs
  );
}

function candidateEvidenceReason(database: AppDatabase, input: PlanInput) {
  if (input.candidate.evidenceRecordIds.length === 0) {
    return "CANDIDATE_EVIDENCE_UNAVAILABLE";
  }
  for (const sourceRecordId of input.candidate.evidenceRecordIds) {
    const record = database.orm
      .select({
        dataClass: sourceRecords.dataClass,
        authorityRole: sources.authorityRole,
        licenseStatus: sources.licenseStatus,
      })
      .from(sourceRecords)
      .innerJoin(sources, eq(sources.id, sourceRecords.sourceId))
      .where(eq(sourceRecords.id, sourceRecordId))
      .get();
    if (!record) return "CANDIDATE_EVIDENCE_UNAVAILABLE";
    if (record.dataClass === "FIXTURE" || record.authorityRole === "FIXTURE") {
      return "FIXTURE_EVIDENCE";
    }
    if (
      record.licenseStatus !== "VERIFIED" ||
      !isTrustedSourceRole(record.authorityRole) ||
      !["REAL", "DELAYED", "HISTORICAL"].includes(record.dataClass)
    ) {
      return "CANDIDATE_EVIDENCE_UNAVAILABLE";
    }
  }
  return null;
}

function availableCash(
  database: AppDatabase,
  ledger: NonNullable<ReturnType<typeof readPaperLedger>>,
) {
  const reserved = new Map<"JPY" | "USD", bigint>([
    ["JPY", BigInt(0)],
    ["USD", BigInt(0)],
  ]);
  for (const order of database.orm
    .select({
      currencyCode: paperOrders.currencyCode,
      reservedAmountMinor: paperOrders.reservedAmountMinor,
    })
    .from(paperOrders)
    .where(inArray(paperOrders.status, ["PENDING", "PARTIALLY_FILLED"]))
    .all()) {
    if (order.currencyCode === "JPY" || order.currencyCode === "USD") {
      reserved.set(
        order.currencyCode,
        reserved.get(order.currencyCode)! + order.reservedAmountMinor,
      );
    }
  }
  return Object.fromEntries(
    (["JPY", "USD"] as const).map((currency) => {
      const balance = ledger.projection.cashBalances.get(currency);
      return [
        currency,
        (
          (balance?.settled ?? BigInt(0)) +
          (balance?.payable ?? BigInt(0)) -
          reserved.get(currency)!
        ).toString(),
      ];
    }),
  );
}

function maxVerifiedEquity(
  database: AppDatabase,
  accountId: string,
  asOfMs: bigint,
) {
  const peak = database.client
    .prepare(
      "SELECT MAX(equity_minor) AS peak FROM equity_valuations WHERE account_id = ? AND status = 'VERIFIED' AND as_of_ms <= ?",
    )
    .get(accountId, asOfMs) as { peak: bigint | null };
  return peak.peak ?? BigInt(0);
}

function assess(
  database: AppDatabase,
  input: PlanInput,
  nowMs: bigint,
): Assessment {
  const requested = BigInt(input.requestedQuantityShares);
  const instrument = database.orm
    .select()
    .from(instruments)
    .where(eq(instruments.id, input.instrumentId))
    .get();
  if (
    !instrument ||
    instrument.classificationStatus !== "VERIFIED" ||
    !instrument.classificationSourceRecordId ||
    instrument.assetClass === "UNKNOWN"
  ) {
    return unavailable(input, "ASSET_CLASS_UNVERIFIED");
  }
  if (
    !["COMMON_STOCK", "NON_LEVERAGED_ETF"].includes(instrument.assetClass) ||
    !["JP", "US"].includes(instrument.marketCode)
  ) {
    return {
      ...unavailable(input, "ASSET_NOT_ALLOWED"),
      status: "REJECT",
    };
  }

  const classEvidence = getSourceEvidence(
    database,
    input.classificationEvidence,
    ["DISCLOSURE", "MARKET_QUOTE", "OTHER"],
    nowMs,
    true,
  );
  if ("reasonCode" in classEvidence) {
    return unavailable(
      input,
      classEvidence.reasonCode === "FIXTURE_EVIDENCE"
        ? "FIXTURE_EVIDENCE"
        : "ASSET_CLASS_UNVERIFIED",
    );
  }
  if (classEvidence.record.id !== instrument.classificationSourceRecordId) {
    return unavailable(input, "ASSET_CLASS_UNVERIFIED");
  }
  const classification = parsePayload(
    input.classificationEvidence!.content,
    classificationPayloadSchema,
  );
  if (
    !classification ||
    !validPeriod(
      classification.validFromMs,
      classification.validUntilMs,
      nowMs,
    ) ||
    classification.instrumentId !== instrument.id ||
    classification.marketCode !== instrument.marketCode ||
    classification.assetClass !== instrument.assetClass ||
    classification.quoteCurrencyCode !== instrument.quoteCurrencyCode ||
    BigInt(classification.tradingUnit) !== instrument.tradingUnit
  ) {
    return unavailable(input, "ASSET_CLASS_UNVERIFIED");
  }

  const quoteEvidence = getSourceEvidence(
    database,
    input.quoteEvidence,
    ["MARKET_QUOTE"],
    nowMs,
  );
  if ("reasonCode" in quoteEvidence) {
    return unavailable(
      input,
      quoteEvidence.reasonCode === "FIXTURE_EVIDENCE"
        ? "FIXTURE_EVIDENCE"
        : "QUOTE_UNAVAILABLE",
    );
  }
  const quote = parsePayload(input.quoteEvidence!.content, quotePayloadSchema);
  if (
    !quote ||
    !validPeriod(quote.validFromMs, quote.validUntilMs, nowMs) ||
    quote.marketAtMs !== Number(quoteEvidence.record.occurredAtMs) ||
    quote.instrumentId !== instrument.id ||
    quote.currencyCode !== instrument.quoteCurrencyCode ||
    priceAtoms(quote.price) <= BigInt(0)
  ) {
    return unavailable(input, "QUOTE_UNAVAILABLE");
  }

  const entryAtoms = priceAtoms(quote.price);
  const stopAtoms = priceAtoms(input.stopReferencePrice);
  if (stopAtoms >= entryAtoms) {
    return {
      ...unavailable(input, "STOP_NOT_BELOW_ENTRY", {
        entryReferencePrice: quote.price,
        stopReferencePrice: input.stopReferencePrice,
      }),
      status: "REJECT",
    };
  }
  const lotSize = BigInt(classification.tradingUnit);
  if (
    (classification.marketCode === "US" && lotSize !== BigInt(1)) ||
    (classification.marketCode === "JP" &&
      classification.assetClass === "COMMON_STOCK" &&
      lotSize !== BigInt(100))
  ) {
    return unavailable(input, "TRADING_UNIT_UNAVAILABLE");
  }
  if (requested % lotSize !== BigInt(0)) {
    return {
      ...unavailable(input, "INVALID_QUANTITY_UNIT", {
        tradingUnit: lotSize.toString(),
      }),
      status: "REJECT",
    };
  }

  const modelEvidence = getSourceEvidence(
    database,
    input.riskModelEvidence,
    ["OTHER"],
    nowMs,
    true,
  );
  if ("reasonCode" in modelEvidence) {
    return unavailable(
      input,
      modelEvidence.reasonCode === "FIXTURE_EVIDENCE"
        ? "FIXTURE_EVIDENCE"
        : "COST_MODEL_UNAVAILABLE",
    );
  }
  const model = parsePayload(
    input.riskModelEvidence!.content,
    paperCostModelSchema,
  );
  if (
    !model ||
    !validPeriod(model.validFromMs, model.validUntilMs, nowMs) ||
    model.marketCode !== instrument.marketCode ||
    model.currencyCode !== instrument.quoteCurrencyCode ||
    priceAtoms(model.tickSize) <= BigInt(0)
  ) {
    return unavailable(input, "COST_MODEL_UNAVAILABLE");
  }

  const candidateReason = candidateEvidenceReason(database, input);
  if (candidateReason)
    return unavailable(input, candidateReason, {}, {}, model.version);

  let fxRate: string | null = null;
  if (instrument.quoteCurrencyCode === "USD") {
    const fxEvidence = getSourceEvidence(
      database,
      input.fxEvidence,
      ["MARKET_QUOTE"],
      nowMs,
    );
    if ("reasonCode" in fxEvidence) {
      return unavailable(input, "FX_UNAVAILABLE", {}, {}, model.version);
    }
    const fx = parsePayload(input.fxEvidence!.content, fxPayloadSchema);
    if (
      !fx ||
      !validPeriod(fx.validFromMs, fx.validUntilMs, nowMs) ||
      fx.marketAtMs !== Number(fxEvidence.record.occurredAtMs) ||
      priceAtoms(fx.rate) <= BigInt(0)
    ) {
      return unavailable(input, "FX_UNAVAILABLE", {}, {}, model.version);
    }
    fxRate = fx.rate;
  }

  const ledger = readPaperLedger(database);
  if (!ledger)
    return unavailable(input, "ACCOUNT_NOT_INITIALIZED", {}, {}, model.version);
  const cash = availableCash(database, ledger);
  const valuationEvidence = [...input.equityEvidence];
  if (
    input.quoteEvidence &&
    !valuationEvidence.some(
      (evidence) =>
        evidence.role === "POSITION_QUOTE" &&
        evidence.instrumentId === input.instrumentId &&
        evidence.sourceRecordId === input.quoteEvidence?.sourceRecordId &&
        evidence.content === input.quoteEvidence?.content,
    )
  ) {
    valuationEvidence.push({
      role: "POSITION_QUOTE",
      instrumentId: input.instrumentId,
      ...input.quoteEvidence,
    });
  }
  if (
    input.fxEvidence &&
    !valuationEvidence.some(
      (evidence) =>
        evidence.role === "FX_RATE" &&
        evidence.sourceRecordId === input.fxEvidence?.sourceRecordId &&
        evidence.content === input.fxEvidence?.content,
    )
  ) {
    valuationEvidence.push({ role: "FX_RATE", ...input.fxEvidence });
  }
  const valuation = createPaperEquitySnapshot(
    database,
    nowMs,
    valuationEvidence,
  );
  if (valuation.status !== "VERIFIED" || valuation.equityMinor === null) {
    return unavailable(
      input,
      "EQUITY_UNRESOLVED",
      {
        valuationId: valuation.id,
        valuationReason: valuation.unresolvedReason,
      },
      cash,
      model.version,
    );
  }
  const equity = valuation.equityMinor;
  if (equity <= BigInt(0)) {
    return {
      ...unavailable(
        input,
        "NON_POSITIVE_EQUITY",
        { valuationId: valuation.id },
        cash,
        model.version,
      ),
      status: "REJECT",
      equityMinor: equity,
      riskBudgetMinor: BigInt(0),
      maxAllowedQuantityShares: BigInt(0),
    };
  }

  const account = database.orm
    .select()
    .from(paperAccounts)
    .where(eq(paperAccounts.id, ledger.account.id))
    .get()!;
  const initialCapital = database.orm
    .select({ amountMinor: initialCapitalConfigs.amountMinor })
    .from(initialCapitalConfigs)
    .where(eq(initialCapitalConfigs.version, account.initialCapitalVersion))
    .get();
  if (!initialCapital) {
    return unavailable(input, "EQUITY_UNRESOLVED", {}, cash, model.version);
  }
  const peak = [
    initialCapital.amountMinor,
    maxVerifiedEquity(database, account.id, nowMs),
  ].reduce((highest, value) => (value > highest ? value : highest));
  if (isDrawdownLimitReached(equity, peak)) {
    return {
      ...unavailable(
        input,
        "DRAWDOWN_LIMIT_REACHED",
        {
          equityMinor: equity.toString(),
          peakEquityMinor: peak.toString(),
          valuationId: valuation.id,
        },
        cash,
        model.version,
      ),
      status: "REJECT",
      equityMinor: equity,
      riskBudgetMinor: equity / BigInt(50),
      maxAllowedQuantityShares: BigInt(0),
    };
  }

  const riskBudget = equity / BigInt(50);
  const tickAtoms = priceAtoms(model.tickSize);
  const entrySlippage = adverseBps(
    entryAtoms,
    model.entrySlippageBps,
    tickAtoms,
  );
  const stopSlippage = adverseBps(stopAtoms, model.stopSlippageBps, tickAtoms);
  const gapReserve = adverseBps(stopAtoms, model.gapReserveBps, tickAtoms);
  const assumedEntry = ceilToTick(entryAtoms + entrySlippage, tickAtoms);
  const assumedStop =
    stopAtoms > stopSlippage + gapReserve
      ? floorToTick(stopAtoms - stopSlippage - gapReserve, tickAtoms)
      : BigInt(0);
  const priceDifference = assumedEntry - assumedStop;
  const currency = instrument.quoteCurrencyCode as "JPY" | "USD";
  const lossFor = (shares: bigint) =>
    feeAndPriceRiskJpyMinor(shares, priceDifference, currency, fxRate, model);
  const currencyCash = BigInt(cash[currency]);
  const riskMax = maxLotQuantity(
    lotSize,
    (shares) => (lossFor(shares) ?? maxSqliteInteger) <= riskBudget,
  );
  const cashMax = maxLotQuantity(
    lotSize,
    (shares) =>
      buyCommitmentMinor(shares, assumedEntry, currency, model.entryFee) <=
      currencyCash,
  );
  const maxAllowed = riskMax < cashMax ? riskMax : cashMax;
  const plannedLoss = lossFor(requested);
  const purchaseCommitment = buyCommitmentMinor(
    requested,
    assumedEntry,
    currency,
    model.entryFee,
  );
  const calculation = {
    computationVersion: checkerVersion,
    valuationId: valuation.id,
    valuationInputHashSha256: valuation.inputHashSha256,
    equityMinor: equity.toString(),
    peakEquityMinor: peak.toString(),
    riskBudgetMinor: riskBudget.toString(),
    entryReferencePrice: quote.price,
    stopReferencePrice: input.stopReferencePrice,
    assumedEntryPriceAtoms: assumedEntry.toString(),
    assumedStopPriceAtoms: assumedStop.toString(),
    currencyCode: currency,
    fxRate,
    quoteSourceRecordId: input.quoteEvidence!.sourceRecordId,
    riskModelVersion: model.version,
    riskModelSourceRecordId: input.riskModelEvidence!.sourceRecordId,
    requestedPlannedLossJpyMinor: plannedLoss?.toString() ?? null,
    requestedBuyCommitmentMinor: purchaseCommitment.toString(),
    riskQuantityLimitShares: riskMax.toString(),
    cashQuantityLimitShares: cashMax.toString(),
  };
  const status = requested > maxAllowed ? "REJECT" : "PASS";
  const reasonCodes =
    status === "PASS"
      ? []
      : [
          requested > riskMax
            ? "RISK_BUDGET_EXCEEDED"
            : "INSUFFICIENT_SETTLED_CASH",
        ];
  return {
    status,
    reasonCodes,
    requestedQuantityShares: requested,
    maxAllowedQuantityShares: maxAllowed,
    equityMinor: equity,
    riskBudgetMinor: riskBudget,
    plannedLossJpyMinor: plannedLoss,
    availableCash: cash,
    calculation,
    ruleVersion: model.version,
  };
}

function appendDecision(
  database: AppDatabase,
  version: typeof paperPlanVersions.$inferSelect,
  input: PlanInput,
  nowMs: bigint,
) {
  const result = assess(database, input, nowMs);
  const latestDecision = database.orm
    .select({ decisionNo: riskDecisions.decisionNo })
    .from(riskDecisions)
    .where(eq(riskDecisions.planVersionId, version.id))
    .orderBy(desc(riskDecisions.decisionNo))
    .limit(1)
    .get();
  const calculationJson = JSON.stringify(result.calculation);
  const inputHashSha256 = hashJson({
    planHashSha256: version.planHashSha256,
    calculation: result.calculation,
    reasonCodes: result.reasonCodes,
    decidedAtMs: nowMs.toString(),
  });
  const decision = {
    id: randomUUID(),
    planVersionId: version.id,
    decisionNo: (latestDecision?.decisionNo ?? BigInt(0)) + BigInt(1),
    planHashSha256: version.planHashSha256,
    status: result.status,
    reasonCodesJson: JSON.stringify(result.reasonCodes),
    requestedQuantityShares: result.requestedQuantityShares,
    maxAllowedQuantityShares: result.maxAllowedQuantityShares,
    equityMinor: result.equityMinor,
    riskBudgetMinor: result.riskBudgetMinor,
    plannedLossJpyMinor:
      result.plannedLossJpyMinor !== null &&
      result.plannedLossJpyMinor <= maxSqliteInteger
        ? result.plannedLossJpyMinor
        : null,
    availableCashJson: JSON.stringify(result.availableCash),
    calculationJson,
    inputHashSha256,
    ruleVersion: result.ruleVersion,
    decidedAtMs: nowMs,
  };
  database.orm.insert(riskDecisions).values(decision).run();
  return {
    ...result,
    id: decision.id,
    planVersionId: version.id,
    planHashSha256: version.planHashSha256,
    inputHashSha256,
    decidedAtMs: nowMs.toString(),
  };
}

function collectEvidenceBindings(database: AppDatabase, input: PlanInput) {
  const references = [
    ...input.candidate.evidenceRecordIds.map((sourceRecordId) => ({
      role: "CANDIDATE",
      sourceRecordId,
    })),
    ...(
      [
        ["CLASSIFICATION", input.classificationEvidence],
        ["QUOTE", input.quoteEvidence],
        ["RISK_MODEL", input.riskModelEvidence],
        ["FX", input.fxEvidence],
      ] as const
    ).flatMap(([role, evidence]) =>
      evidence ? [{ role, sourceRecordId: evidence.sourceRecordId }] : [],
    ),
    ...input.equityEvidence.map((evidence) => ({
      role: evidence.role === "FX_RATE" ? "FX" : "QUOTE",
      sourceRecordId: evidence.sourceRecordId,
    })),
  ];
  const seen = new Set<string>();
  const bindings: {
    role: string;
    sourceRecordId: string;
    contentHashSha256: string;
  }[] = [];
  for (const { role, sourceRecordId } of references) {
    const key = `${role}:${sourceRecordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceRecord = database.orm
      .select({ contentHashSha256: sourceRecords.contentHashSha256 })
      .from(sourceRecords)
      .where(eq(sourceRecords.id, sourceRecordId))
      .get();
    if (sourceRecord) {
      bindings.push({
        role,
        sourceRecordId,
        contentHashSha256: sourceRecord.contentHashSha256,
      });
    }
  }
  return bindings.sort((a, b) =>
    `${a.role}:${a.sourceRecordId}`.localeCompare(
      `${b.role}:${b.sourceRecordId}`,
    ),
  );
}

function addVersion(
  database: AppDatabase,
  planId: string,
  versionNo: bigint,
  input: PlanInput,
  nowMs: bigint,
) {
  const id = randomUUID();
  const candidateSnapshotJson = JSON.stringify(input.candidate);
  const inputSnapshotJson = JSON.stringify(input);
  const evidenceBindings = collectEvidenceBindings(database, input);
  const planHashSha256 = hashJson({
    planId,
    versionNo: versionNo.toString(),
    input,
    evidenceBindings,
  });
  const version = {
    id,
    planId,
    versionNo,
    instrumentId: input.instrumentId,
    requestedQuantityShares: BigInt(input.requestedQuantityShares),
    candidateSnapshotJson,
    inputSnapshotJson,
    planHashSha256,
    createdAtMs: nowMs,
  };
  database.orm.insert(paperPlanVersions).values(version).run();
  for (const binding of evidenceBindings) {
    database.orm
      .insert(planInputEvidence)
      .values({ id: randomUUID(), planVersionId: id, ...binding })
      .run();
  }
  const decision = appendDecision(database, version, input, nowMs);
  return { version, decision };
}

export function parsePlanInputSnapshot(value: string) {
  try {
    const parsed = planInputSchema.safeParse(JSON.parse(value) as unknown);
    if (parsed.success) return parsed.data;
  } catch {
    // The stored plan snapshot is an internal, immutable database value.
  }
  throw new Error("paper_plan_snapshot_invalid");
}

export function createPaperPlan(database: AppDatabase, input: unknown) {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("paper_plan_input_invalid");
  return withTransaction(database, () => {
    const nowMs = BigInt(Date.now());
    const planId = randomUUID();
    const plan = {
      id: planId,
      candidateId: parsed.data.candidate.candidateId,
      createdAtMs: nowMs,
    };
    database.orm.insert(paperPlans).values(plan).run();
    const { version, decision } = addVersion(
      database,
      planId,
      BigInt(1),
      parsed.data,
      nowMs,
    );
    return { plan, version, decision };
  });
}

export function createPaperPlanVersion(
  database: AppDatabase,
  planId: string,
  input: unknown,
) {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("paper_plan_input_invalid");
  return withTransaction(database, () => {
    const plan = database.orm
      .select({ id: paperPlans.id })
      .from(paperPlans)
      .where(eq(paperPlans.id, planId))
      .get();
    if (!plan) throw new Error("paper_plan_not_found");
    const latest = database.orm
      .select({ versionNo: paperPlanVersions.versionNo })
      .from(paperPlanVersions)
      .where(eq(paperPlanVersions.planId, planId))
      .orderBy(desc(paperPlanVersions.versionNo))
      .limit(1)
      .get();
    const { version, decision } = addVersion(
      database,
      planId,
      (latest?.versionNo ?? BigInt(0)) + BigInt(1),
      parsed.data,
      BigInt(Date.now()),
    );
    return { version, decision };
  });
}

function loadVersion(database: AppDatabase, planVersionId: string) {
  const version = database.orm
    .select()
    .from(paperPlanVersions)
    .where(eq(paperPlanVersions.id, planVersionId))
    .get();
  if (!version) throw new Error("paper_plan_version_not_found");
  return version;
}

export function evaluatePaperPlan(
  database: AppDatabase,
  planVersionId: string,
) {
  return withTransaction(database, () => {
    const version = loadVersion(database, planVersionId);
    const input = parsePlanInputSnapshot(version.inputSnapshotJson);
    return appendDecision(database, version, input, BigInt(Date.now()));
  });
}

export function approvePaperPlan(
  database: AppDatabase,
  planVersionId: string,
  expectedPlanHashSha256: string,
) {
  return withTransaction(database, () => {
    const version = loadVersion(database, planVersionId);
    if (version.planHashSha256 !== expectedPlanHashSha256) {
      throw new Error("paper_plan_version_conflict");
    }
    const existing = database.orm
      .select({ id: planApprovals.id })
      .from(planApprovals)
      .where(eq(planApprovals.planVersionId, version.id))
      .get();
    if (existing) throw new Error("paper_plan_already_approved");
    const input = parsePlanInputSnapshot(version.inputSnapshotJson);
    const decision = appendDecision(
      database,
      version,
      input,
      BigInt(Date.now()),
    );
    if (decision.status !== "PASS") return { decision, approval: null };
    const approval = {
      id: randomUUID(),
      planVersionId: version.id,
      planHashSha256: version.planHashSha256,
      riskDecisionId: decision.id,
      approvedAtMs: BigInt(decision.decidedAtMs),
    };
    database.orm.insert(planApprovals).values(approval).run();
    return { decision, approval };
  });
}
