import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { type AppDatabase, withTransaction } from "@/db";
import {
  instruments,
  paperAccounts,
  paperFills,
  paperOrderEvents,
  paperOrders,
  paperPlanVersions,
  planApprovals,
  riskDecisions,
} from "@/db/schema";
import { marketDateAt, parseFixedDecimal } from "@/domain/primitives";
import { marketCalendarStateAt } from "@/features/market-calendar/market-calendar";
import {
  feeMinor,
  paperCostModelSchema,
  priceAtoms,
} from "@/features/paper/cost-model";
import {
  appendPaperLedgerEvent,
  readPaperLedger,
} from "@/features/paper/ledger";
import {
  getSourceEvidence,
  sourceEvidenceInputSchema,
} from "@/features/risk/evidence";
import { parsePlanInputSnapshot } from "@/features/risk/checker";

const SCALE = BigInt(10) ** BigInt(8);
const BPS = BigInt(10_000);
const maxSqliteInteger = (BigInt(1) << BigInt(63)) - BigInt(1);
const decimalSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const integerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((value) => BigInt(value) <= maxSqliteInteger);
const timestampSchema = z.number().int().nonnegative().safe();

const createOrderInputSchema = z.strictObject({
  planVersionId: z.uuid(),
  expectedPlanHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().trim().min(1).max(160),
});

const quotePayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  instrumentId: z.uuid(),
  currencyCode: z.enum(["JPY", "USD"]),
  price: decimalSchema,
  volumeShares: integerStringSchema,
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
const executableCostModelSchema = paperCostModelSchema.extend({
  maxParticipationBps: z.number().int().min(1).max(10_000).safe(),
});

const decisionCalculationSchema = z.object({
  assumedStopPriceAtoms: integerStringSchema,
  currencyCode: z.enum(["JPY", "USD"]),
  requestedBuyCommitmentMinor: integerStringSchema,
  riskModelVersion: z.string().min(1).max(64),
  fxRate: decimalSchema.nullable(),
});

const executeOrderInputSchema = z.strictObject({
  orderId: z.uuid(),
  quoteEvidence: sourceEvidenceInputSchema,
  fxEvidence: sourceEvidenceInputSchema.nullable().optional(),
});

const cancelOrderInputSchema = z.strictObject({
  orderId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(160),
});

function ceilDivide(numerator: bigint, denominator: bigint) {
  if (numerator <= BigInt(0)) return numerator / denominator;
  return (numerator + denominator - BigInt(1)) / denominator;
}

function ceilToTick(value: bigint, tick: bigint) {
  return ceilDivide(value, tick) * tick;
}

function priceLossMinor(
  priceDifferenceAtoms: bigint,
  shares: bigint,
  currency: "JPY" | "USD",
) {
  const currencyScale = currency === "JPY" ? BigInt(0) : BigInt(2);
  return ceilDivide(
    priceDifferenceAtoms * shares * BigInt(10) ** currencyScale,
    SCALE,
  );
}

function convertedRiskJpyMinor(
  amountMinor: bigint,
  currency: "JPY" | "USD",
  rate: string | null,
  model: z.infer<typeof paperCostModelSchema>,
) {
  if (currency === "JPY") return amountMinor;
  if (!rate) return null;
  const parsedRate = parseFixedDecimal(rate);
  const converted = ceilDivide(
    amountMinor * parsedRate.mantissa * (BPS + BigInt(model.fxShockBps)),
    BigInt(100) * BigInt(10) ** BigInt(parsedRate.scale) * BPS,
  );
  return (
    converted + ceilDivide(converted * BigInt(model.fxConversionFeeBps), BPS)
  );
}

function notionalMinor(price: bigint, shares: bigint, currency: "JPY" | "USD") {
  const currencyScale = currency === "JPY" ? BigInt(0) : BigInt(2);
  return ceilDivide(price * shares * BigInt(10) ** currencyScale, SCALE);
}

function maxLotQuantity(
  maximum: bigint,
  lotSize: bigint,
  fits: (shares: bigint) => boolean,
) {
  let low = BigInt(0);
  let high = maximum / lotSize;
  while (low < high) {
    const middle = (low + high + BigInt(1)) / BigInt(2);
    if (fits(middle * lotSize)) low = middle;
    else high = middle - BigInt(1);
  }
  return low * lotSize;
}

function parsePayload<T>(content: string, schema: z.ZodType<T>) {
  try {
    const result = schema.safeParse(JSON.parse(content) as unknown);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function localAccount(database: AppDatabase) {
  return database.orm
    .select({ id: paperAccounts.id })
    .from(paperAccounts)
    .where(eq(paperAccounts.accountKey, "local-default"))
    .get();
}

function loadOrder(database: AppDatabase, orderId: string) {
  const order = database.orm
    .select()
    .from(paperOrders)
    .where(eq(paperOrders.id, orderId))
    .get();
  if (!order) throw new Error("paper_order_not_found");
  return order;
}

function appendOrderEvent(
  database: AppDatabase,
  order: typeof paperOrders.$inferSelect,
  input: {
    eventType: string;
    fromStatus: string | null;
    toStatus: string;
    idempotencyKey: string;
    effectiveAtMs: bigint;
    recordedAtMs: bigint;
    reservedAfterMinor: bigint;
    filledQuantityShares: bigint;
    reasonCode?: string | null;
    ledgerEventId?: string | null;
  },
) {
  const previous = database.orm
    .select({ sequenceNo: paperOrderEvents.sequenceNo })
    .from(paperOrderEvents)
    .where(eq(paperOrderEvents.orderId, order.id))
    .orderBy(desc(paperOrderEvents.sequenceNo))
    .limit(1)
    .get();
  database.orm
    .insert(paperOrderEvents)
    .values({
      id: randomUUID(),
      orderId: order.id,
      sequenceNo: (previous?.sequenceNo ?? BigInt(0)) + BigInt(1),
      eventType: input.eventType,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      idempotencyKey: input.idempotencyKey,
      effectiveAtMs: input.effectiveAtMs,
      recordedAtMs: input.recordedAtMs,
      reservedBeforeMinor: order.reservedAmountMinor,
      reservedAfterMinor: input.reservedAfterMinor,
      filledQuantityShares: input.filledQuantityShares,
      reasonCode: input.reasonCode ?? null,
      ledgerEventId: input.ledgerEventId ?? null,
    })
    .run();
}

function loadApprovedContext(
  database: AppDatabase,
  orderId: string,
  nowMs: bigint,
) {
  const order = loadOrder(database, orderId);
  const version = database.orm
    .select()
    .from(paperPlanVersions)
    .where(eq(paperPlanVersions.id, order.planVersionId))
    .get();
  const approval = database.orm
    .select()
    .from(planApprovals)
    .where(eq(planApprovals.id, order.planApprovalId))
    .get();
  const latestDecision = database.orm
    .select()
    .from(riskDecisions)
    .where(eq(riskDecisions.planVersionId, order.planVersionId))
    .orderBy(desc(riskDecisions.decisionNo))
    .limit(1)
    .get();
  const decision = approval
    ? database.orm
        .select()
        .from(riskDecisions)
        .where(eq(riskDecisions.id, approval.riskDecisionId))
        .get()
    : null;
  if (
    !version ||
    !approval ||
    !decision ||
    !latestDecision ||
    latestDecision.id !== decision.id ||
    decision.status !== "PASS" ||
    decision.planHashSha256 !== version.planHashSha256 ||
    approval.planHashSha256 !== version.planHashSha256 ||
    order.planHashSha256 !== version.planHashSha256
  ) {
    return { order, reasonCode: "APPROVAL_UNAVAILABLE" } as const;
  }

  const input = parsePlanInputSnapshot(version.inputSnapshotJson);
  const calculation = parsePayload(
    decision.calculationJson,
    decisionCalculationSchema,
  );
  const instrument = database.orm
    .select()
    .from(instruments)
    .where(eq(instruments.id, order.instrumentId))
    .get();
  if (!input.riskModelEvidence)
    return { order, reasonCode: "COST_MODEL_UNAVAILABLE" } as const;
  const costEvidence = getSourceEvidence(
    database,
    input.riskModelEvidence,
    ["OTHER"],
    nowMs,
  );
  if (
    !calculation ||
    !instrument ||
    !decision.riskBudgetMinor ||
    !("record" in costEvidence) ||
    !costEvidence.record ||
    costEvidence.record.dataClass !== "REAL"
  ) {
    return { order, reasonCode: "COST_MODEL_UNAVAILABLE" } as const;
  }
  const model = parsePayload(
    input.riskModelEvidence.content,
    executableCostModelSchema,
  );
  if (
    !model ||
    model.version !== decision.ruleVersion ||
    model.version !== calculation.riskModelVersion ||
    model.currencyCode !== order.currencyCode ||
    model.marketCode !== instrument.marketCode ||
    model.validFromMs > Number(nowMs) ||
    model.validUntilMs < Number(nowMs)
  ) {
    return { order, reasonCode: "COST_MODEL_UNAVAILABLE" } as const;
  }
  return {
    order,
    version,
    approval,
    decision,
    calculation,
    instrument,
    input,
    model,
    costModelRecordId: costEvidence.record.id,
  } as const;
}

export function createPaperOrder(database: AppDatabase, value: unknown) {
  const parsed = createOrderInputSchema.safeParse(value);
  if (!parsed.success) throw new Error("paper_order_input_invalid");

  return withTransaction(database, () => {
    const { planVersionId, expectedPlanHashSha256, idempotencyKey } =
      parsed.data;
    const account = localAccount(database);
    if (!account) throw new Error("paper_account_not_initialized");
    const sameKey = database.orm
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.accountId, account.id),
          eq(paperOrders.idempotencyKey, idempotencyKey),
        ),
      )
      .get();
    if (sameKey) {
      if (
        sameKey.planVersionId !== planVersionId ||
        sameKey.planHashSha256 !== expectedPlanHashSha256
      )
        throw new Error("paper_order_idempotency_conflict");
      return sameKey;
    }
    const existingPlanOrder = database.orm
      .select({ id: paperOrders.id })
      .from(paperOrders)
      .where(eq(paperOrders.planVersionId, planVersionId))
      .get();
    if (existingPlanOrder) throw new Error("paper_order_already_created");

    const version = database.orm
      .select()
      .from(paperPlanVersions)
      .where(eq(paperPlanVersions.id, planVersionId))
      .get();
    if (!version) throw new Error("paper_plan_version_not_found");
    if (version.planHashSha256 !== expectedPlanHashSha256)
      throw new Error("paper_plan_version_conflict");
    const ledger = readPaperLedger(database);
    if (!ledger) throw new Error("paper_account_not_initialized");

    const approval = database.orm
      .select()
      .from(planApprovals)
      .where(eq(planApprovals.planVersionId, version.id))
      .get();
    const latestDecision = database.orm
      .select()
      .from(riskDecisions)
      .where(eq(riskDecisions.planVersionId, version.id))
      .orderBy(desc(riskDecisions.decisionNo))
      .limit(1)
      .get();
    const decision = approval
      ? database.orm
          .select()
          .from(riskDecisions)
          .where(eq(riskDecisions.id, approval.riskDecisionId))
          .get()
      : null;
    if (
      !approval ||
      !decision ||
      !latestDecision ||
      latestDecision.id !== decision.id ||
      decision.status !== "PASS" ||
      decision.planHashSha256 !== version.planHashSha256 ||
      approval.planHashSha256 !== version.planHashSha256 ||
      decision.requestedQuantityShares !== version.requestedQuantityShares
    ) {
      throw new Error("paper_order_approval_unavailable");
    }

    const nowMs = BigInt(Date.now());
    const input = parsePlanInputSnapshot(version.inputSnapshotJson);
    const calculation = parsePayload(
      decision.calculationJson,
      decisionCalculationSchema,
    );
    const model = input.riskModelEvidence
      ? parsePayload(input.riskModelEvidence.content, executableCostModelSchema)
      : null;
    const instrument = database.orm
      .select()
      .from(instruments)
      .where(eq(instruments.id, version.instrumentId))
      .get();
    if (
      !calculation ||
      !model ||
      !instrument ||
      !decision.riskBudgetMinor ||
      calculation.currencyCode !== instrument.quoteCurrencyCode ||
      model.currencyCode !== instrument.quoteCurrencyCode ||
      model.marketCode !== instrument.marketCode
    ) {
      throw new Error("paper_order_approval_unavailable");
    }
    if (!input.riskModelEvidence)
      throw new Error("paper_order_cost_model_unavailable");
    const costEvidence = getSourceEvidence(
      database,
      input.riskModelEvidence,
      ["OTHER"],
      nowMs,
    );
    if (
      !("record" in costEvidence) ||
      !costEvidence.record ||
      costEvidence.record.dataClass !== "REAL" ||
      model.version !== decision.ruleVersion ||
      model.validFromMs > Number(nowMs) ||
      model.validUntilMs < Number(nowMs)
    ) {
      throw new Error("paper_order_cost_model_unavailable");
    }
    const reserve = BigInt(calculation.requestedBuyCommitmentMinor);
    const availableCash =
      (ledger.projection.cashBalances.get(instrument.quoteCurrencyCode)
        ?.settled ?? BigInt(0)) +
      (ledger.projection.cashBalances.get(instrument.quoteCurrencyCode)
        ?.payable ?? BigInt(0)) -
      database.orm
        .select({
          currencyCode: paperOrders.currencyCode,
          reservedAmountMinor: paperOrders.reservedAmountMinor,
        })
        .from(paperOrders)
        .where(inArray(paperOrders.status, ["PENDING", "PARTIALLY_FILLED"]))
        .all()
        .reduce(
          (sum, order) =>
            order.currencyCode === instrument.quoteCurrencyCode
              ? sum + order.reservedAmountMinor
              : sum,
          BigInt(0),
        );
    if (reserve <= BigInt(0) || reserve > availableCash)
      throw new Error("paper_order_insufficient_settled_cash");

    const order = {
      id: randomUUID(),
      accountId: account.id,
      planVersionId: version.id,
      planApprovalId: approval.id,
      planHashSha256: version.planHashSha256,
      instrumentId: instrument.id,
      requestedQuantityShares: version.requestedQuantityShares,
      filledQuantityShares: BigInt(0),
      currencyCode: instrument.quoteCurrencyCode,
      reservedAmountMinor: reserve,
      feesChargedMinor: BigInt(0),
      status: "PENDING",
      idempotencyKey,
      reasonCode: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    } as const;
    database.orm.insert(paperOrders).values(order).run();
    appendOrderEvent(database, order, {
      eventType: "SUBMITTED",
      fromStatus: null,
      toStatus: "PENDING",
      idempotencyKey: `submit:${idempotencyKey}`,
      effectiveAtMs: nowMs,
      recordedAtMs: nowMs,
      reservedAfterMinor: reserve,
      filledQuantityShares: BigInt(0),
    });
    return order;
  });
}

function settlementDate(market: "JP" | "US", marketAtMs: number) {
  const exchange = market === "JP" ? "TSE" : "NYSE";
  const businessDays = market === "JP" ? 2 : 1;
  const checkHourUtc = market === "JP" ? 3 : 16;
  const date = new Date(`${marketDateAt(marketAtMs, market)}T00:00:00.000Z`);
  let counted = 0;
  for (
    let attempts = 0;
    attempts < 15 && counted < businessDays;
    attempts += 1
  ) {
    date.setUTCDate(date.getUTCDate() + 1);
    const nextDate = date.toISOString().slice(0, 10);
    const state = marketCalendarStateAt(
      exchange,
      Date.parse(
        `${nextDate}T${String(checkHourUtc).padStart(2, "0")}:00:00.000Z`,
      ),
    );
    if (state.status === "CALENDAR_UNAVAILABLE")
      throw new Error("settlement_calendar_unavailable");
    if (
      state.status === "OPEN" ||
      (state.status === "CLOSED" && state.reason === "OUTSIDE_SESSION")
    ) {
      counted += 1;
    }
  }
  if (counted !== businessDays) throw new Error("settlement_date_unavailable");
  return {
    date: date.toISOString().slice(0, 10),
    ruleVersion: market === "JP" ? "jp-t2-2019-v1" : "us-t1-2024-v1",
  };
}

function riskForFill(
  priorFills: (typeof paperFills.$inferSelect)[],
  filledQuantityShares: bigint,
  input: {
    shares: bigint;
    fillPriceAtoms: bigint;
    stopPriceAtoms: bigint;
    currency: "JPY" | "USD";
    fxRate: string | null;
    model: z.infer<typeof paperCostModelSchema>;
  },
) {
  const priorShares = priorFills.reduce(
    (sum, fill) => sum + fill.quantityShares,
    BigInt(0),
  );
  if (priorShares !== filledQuantityShares)
    throw new Error("paper_order_fill_projection_mismatch");
  const totalShares = priorShares + input.shares;
  const stopLoss = priorFills.reduce((sum, fill) => {
    const fillPrice =
      fill.priceMantissa * BigInt(10) ** BigInt(8 - fill.priceScale);
    const difference =
      fillPrice > input.stopPriceAtoms
        ? fillPrice - input.stopPriceAtoms
        : BigInt(0);
    return (
      sum + priceLossMinor(difference, fill.quantityShares, input.currency)
    );
  }, BigInt(0));
  const currentDifference =
    input.fillPriceAtoms > input.stopPriceAtoms
      ? input.fillPriceAtoms - input.stopPriceAtoms
      : BigInt(0);
  const nativeRisk =
    stopLoss +
    priceLossMinor(currentDifference, input.shares, input.currency) +
    feeMinor(input.model.entryFee, totalShares) +
    feeMinor(input.model.exitFee, totalShares);
  return convertedRiskJpyMinor(
    nativeRisk,
    input.currency,
    input.fxRate,
    input.model,
  );
}

function rejectAttempt(
  database: AppDatabase,
  order: typeof paperOrders.$inferSelect,
  input: {
    quoteRecordId: string;
    reasonCode: string;
    resultClass: "NOT_VERIFIED" | "DEMO_ONLY";
    effectiveAtMs: bigint;
    nowMs: bigint;
  },
) {
  const effectiveAtMs =
    input.effectiveAtMs > input.nowMs ? input.nowMs : input.effectiveAtMs;
  const eventKey = `attempt:${input.quoteRecordId}`;
  const prior = database.orm
    .select()
    .from(paperOrderEvents)
    .where(
      and(
        eq(paperOrderEvents.orderId, order.id),
        eq(paperOrderEvents.idempotencyKey, eventKey),
      ),
    )
    .get();
  if (!prior) {
    appendOrderEvent(database, order, {
      eventType: "EXECUTION_REJECTED",
      fromStatus: order.status,
      toStatus: order.status,
      idempotencyKey: eventKey,
      effectiveAtMs,
      recordedAtMs: input.nowMs,
      reservedAfterMinor: order.reservedAmountMinor,
      filledQuantityShares: order.filledQuantityShares,
      reasonCode: input.reasonCode,
    });
  }
  return {
    status: "REJECTED" as const,
    order: loadOrder(database, order.id),
    fill: null,
    reasonCode: prior?.reasonCode ?? input.reasonCode,
    resultClass: input.resultClass,
    replayed: Boolean(prior),
  };
}

export function executePaperOrder(database: AppDatabase, value: unknown) {
  const parsed = executeOrderInputSchema.safeParse(value);
  if (!parsed.success) throw new Error("paper_order_execution_input_invalid");

  return withTransaction(database, () => {
    const now = Date.now();
    const nowMs = BigInt(now);
    const { order, ...context } = loadApprovedContext(
      database,
      parsed.data.orderId,
      nowMs,
    );
    const quote = parsePayload(
      parsed.data.quoteEvidence.content,
      quotePayloadSchema,
    );
    const quoteEvidence = getSourceEvidence(
      database,
      parsed.data.quoteEvidence,
      ["MARKET_QUOTE"],
      nowMs,
    );
    const marketAtMs = quote?.marketAtMs ?? now;
    const priorFill = database.orm
      .select()
      .from(paperFills)
      .where(
        and(
          eq(paperFills.orderId, order.id),
          eq(paperFills.fillKey, parsed.data.quoteEvidence.sourceRecordId),
        ),
      )
      .get();
    if (priorFill) {
      return {
        status: order.status as "FILLED" | "PARTIALLY_FILLED",
        order,
        fill: priorFill,
        reasonCode: null,
        resultClass: "VERIFIED" as const,
        replayed: true,
      };
    }
    if (order.status !== "PENDING" && order.status !== "PARTIALLY_FILLED") {
      return {
        status: "REJECTED" as const,
        order,
        fill: null,
        reasonCode: "ORDER_NOT_OPEN",
        resultClass: "NOT_VERIFIED" as const,
        replayed: false,
      };
    }
    if ("reasonCode" in context && context.reasonCode) {
      return rejectAttempt(database, order, {
        quoteRecordId: parsed.data.quoteEvidence.sourceRecordId,
        reasonCode: context.reasonCode,
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(marketAtMs),
        nowMs,
      });
    }
    if ("reasonCode" in quoteEvidence && quoteEvidence.reasonCode) {
      return rejectAttempt(database, order, {
        quoteRecordId: parsed.data.quoteEvidence.sourceRecordId,
        reasonCode: quoteEvidence.reasonCode,
        resultClass:
          quoteEvidence.reasonCode === "FIXTURE_EVIDENCE"
            ? "DEMO_ONLY"
            : "NOT_VERIFIED",
        effectiveAtMs: BigInt(marketAtMs),
        nowMs,
      });
    }
    if (quoteEvidence.record.dataClass !== "REAL") {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "QUOTE_NOT_REAL",
        resultClass:
          quoteEvidence.record.dataClass === "FIXTURE"
            ? "DEMO_ONLY"
            : "NOT_VERIFIED",
        effectiveAtMs: BigInt(marketAtMs),
        nowMs,
      });
    }
    if (
      !quote ||
      quoteEvidence.record.occurredAtMs === null ||
      quote.marketAtMs !== Number(quoteEvidence.record.occurredAtMs) ||
      quote.marketAtMs > now ||
      quote.marketAtMs < quote.validFromMs ||
      quote.marketAtMs > quote.validUntilMs ||
      quote.validFromMs > now ||
      quote.validUntilMs < now ||
      quote.validUntilMs < quote.validFromMs ||
      quote.instrumentId !== context.instrument.id ||
      quote.currencyCode !== context.instrument.quoteCurrencyCode ||
      priceAtoms(quote.price) <= BigInt(0)
    ) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "QUOTE_UNAVAILABLE",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(marketAtMs),
        nowMs,
      });
    }

    const calendar = marketCalendarStateAt(
      context.instrument.marketCode === "JP" ? "TSE" : "NYSE",
      quote.marketAtMs,
    );
    if (calendar.status !== "OPEN") {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode:
          calendar.status === "CALENDAR_UNAVAILABLE"
            ? "MARKET_CALENDAR_UNAVAILABLE"
            : "MARKET_CLOSED",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }

    let fxRate: string | null = null;
    let fxSourceRecordId: string | null = null;
    if (context.instrument.quoteCurrencyCode === "USD") {
      const fxInput = parsed.data.fxEvidence;
      const fxEvidence = fxInput
        ? getSourceEvidence(database, fxInput, ["MARKET_QUOTE"], nowMs)
        : null;
      const fx = fxInput
        ? parsePayload(fxInput.content, fxPayloadSchema)
        : null;
      if (
        !fxInput ||
        !fxEvidence ||
        "reasonCode" in fxEvidence ||
        fxEvidence.record.dataClass !== "REAL" ||
        !fx ||
        fx.marketAtMs !== Number(fxEvidence.record.occurredAtMs) ||
        fx.marketAtMs > now ||
        fx.marketAtMs < fx.validFromMs ||
        fx.marketAtMs > fx.validUntilMs ||
        fx.validFromMs > now ||
        fx.validUntilMs < now ||
        fx.validUntilMs < fx.validFromMs ||
        priceAtoms(fx.rate) <= BigInt(0)
      ) {
        return rejectAttempt(database, order, {
          quoteRecordId: quoteEvidence.record.id,
          reasonCode: "FX_UNAVAILABLE",
          resultClass: "NOT_VERIFIED",
          effectiveAtMs: BigInt(quote.marketAtMs),
          nowMs,
        });
      }
      fxRate = fx.rate;
      fxSourceRecordId = fxEvidence.record.id;
    }

    const previousApproval = database.orm
      .select({ id: riskDecisions.id })
      .from(riskDecisions)
      .where(eq(riskDecisions.planVersionId, order.planVersionId))
      .orderBy(desc(riskDecisions.decisionNo))
      .limit(1)
      .get();
    if (previousApproval?.id !== context.decision.id) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "APPROVAL_STALE",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }

    const currency = context.instrument.quoteCurrencyCode as "JPY" | "USD";
    const tickAtoms = priceAtoms(context.model.tickSize);
    const referencePriceAtoms = priceAtoms(quote.price);
    if (
      tickAtoms <= BigInt(0) ||
      referencePriceAtoms <= BigInt(0) ||
      referencePriceAtoms > maxSqliteInteger
    ) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "QUOTE_PRICE_OUT_OF_RANGE",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }
    if (referencePriceAtoms <= priceAtoms(context.input.stopReferencePrice)) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "ENTRY_PRICE_AT_OR_BELOW_STOP",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }
    const slippage = ceilDivide(
      referencePriceAtoms * BigInt(context.model.entrySlippageBps),
      BPS,
    );
    const fillPriceAtoms = ceilToTick(
      referencePriceAtoms + slippage,
      tickAtoms,
    );
    if (fillPriceAtoms > maxSqliteInteger) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "QUOTE_PRICE_OUT_OF_RANGE",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }
    const lotSize = context.instrument.tradingUnit;
    const remaining =
      order.requestedQuantityShares - order.filledQuantityShares;
    const volumeCapacity =
      (BigInt(quote.volumeShares) * BigInt(context.model.maxParticipationBps)) /
      BPS;
    const volumeShares = (volumeCapacity / lotSize) * lotSize;
    if (volumeShares <= BigInt(0)) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "VOLUME_BELOW_TRADING_UNIT",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }

    const priorFills = database.orm
      .select()
      .from(paperFills)
      .where(eq(paperFills.orderId, order.id))
      .all();
    const stopPriceAtoms = BigInt(context.calculation.assumedStopPriceAtoms);
    const riskMaximum = maxLotQuantity(
      remaining < volumeShares ? remaining : volumeShares,
      lotSize,
      (shares) =>
        (riskForFill(priorFills, order.filledQuantityShares, {
          shares,
          fillPriceAtoms,
          stopPriceAtoms,
          currency,
          fxRate,
          model: context.model,
        }) ?? maxSqliteInteger) <= context.decision.riskBudgetMinor!,
    );
    if (riskMaximum <= BigInt(0)) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "GAP_EXCEEDS_RISK_BUDGET",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }

    const quantityShares = maxLotQuantity(riskMaximum, lotSize, (shares) => {
      const nextFilled = order.filledQuantityShares + shares;
      const additionalFee =
        feeMinor(context.model.entryFee, nextFilled) - order.feesChargedMinor;
      return (
        additionalFee >= BigInt(0) &&
        notionalMinor(fillPriceAtoms, shares, currency) + additionalFee <=
          order.reservedAmountMinor
      );
    });
    if (quantityShares <= BigInt(0)) {
      return rejectAttempt(database, order, {
        quoteRecordId: quoteEvidence.record.id,
        reasonCode: "RESERVED_CASH_INSUFFICIENT",
        resultClass: "NOT_VERIFIED",
        effectiveAtMs: BigInt(quote.marketAtMs),
        nowMs,
      });
    }

    const filledQuantity = order.filledQuantityShares + quantityShares;
    const feeMinorForFill =
      feeMinor(context.model.entryFee, filledQuantity) - order.feesChargedMinor;
    const purchaseMinor = notionalMinor(
      fillPriceAtoms,
      quantityShares,
      currency,
    );
    const reservedAfter =
      filledQuantity === order.requestedQuantityShares
        ? BigInt(0)
        : order.reservedAmountMinor - purchaseMinor - feeMinorForFill;
    let settlement: ReturnType<typeof settlementDate>;
    try {
      settlement = settlementDate(
        context.instrument.marketCode as "JP" | "US",
        quote.marketAtMs,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "settlement_calendar_unavailable",
          "settlement_date_unavailable",
        ].includes(error.message)
      ) {
        return rejectAttempt(database, order, {
          quoteRecordId: quoteEvidence.record.id,
          reasonCode: "SETTLEMENT_CALENDAR_UNAVAILABLE",
          resultClass: "NOT_VERIFIED",
          effectiveAtMs: BigInt(quote.marketAtMs),
          nowMs,
        });
      }
      throw error;
    }
    const fillEvent = appendPaperLedgerEvent(database, {
      eventType: "FILL",
      idempotencyKey: `paper-fill:${order.id}:${quoteEvidence.record.id}`,
      effectiveAtMs: BigInt(quote.marketAtMs),
      ruleVersion: "paper-fill-v1",
      sourceRecordId: quoteEvidence.record.id,
      cashPosting: {
        bucket: "SETTLED",
        currencyCode: currency,
        currencyScale: currency === "JPY" ? 0 : 2,
        amountMinor: -purchaseMinor,
      },
      positionPosting: {
        instrumentId: context.instrument.id,
        quantityShares,
      },
    });
    const feeEvent =
      feeMinorForFill > BigInt(0)
        ? appendPaperLedgerEvent(database, {
            eventType: "FEE",
            idempotencyKey: `paper-fill:${order.id}:${quoteEvidence.record.id}:fee`,
            effectiveAtMs: BigInt(quote.marketAtMs),
            ruleVersion: "paper-fee-v1",
            sourceRecordId: context.costModelRecordId,
            cashPosting: {
              bucket: "SETTLED",
              currencyCode: currency,
              currencyScale: currency === "JPY" ? 0 : 2,
              amountMinor: -feeMinorForFill,
            },
          })
        : null;
    const fillId = randomUUID();
    const fill = {
      id: fillId,
      orderId: order.id,
      fillKey: quoteEvidence.record.id,
      ledgerEventId: fillEvent.id,
      feeLedgerEventId: feeEvent?.id ?? null,
      quantityShares,
      priceMantissa: fillPriceAtoms,
      priceScale: 8,
      currencyCode: currency,
      feeMinor: feeMinorForFill,
      executionDataClass: "REAL",
      quoteRecordId: quoteEvidence.record.id,
      fxSourceRecordId,
      fxRate,
      marketAtMs: BigInt(quote.marketAtMs),
      executedAtMs: nowMs,
      settlementDate: settlement.date,
      settlementRuleVersion: settlement.ruleVersion,
      costModelVersion: context.model.version,
      matchingRuleVersion: "paper-market-v1",
    } as const;
    database.orm.insert(paperFills).values(fill).run();

    const status =
      filledQuantity === order.requestedQuantityShares
        ? "FILLED"
        : "PARTIALLY_FILLED";
    database.orm
      .update(paperOrders)
      .set({
        filledQuantityShares: filledQuantity,
        reservedAmountMinor: reservedAfter,
        feesChargedMinor: order.feesChargedMinor + feeMinorForFill,
        status,
        updatedAtMs: nowMs,
      })
      .where(eq(paperOrders.id, order.id))
      .run();
    appendOrderEvent(database, order, {
      eventType: status === "FILLED" ? "FILL" : "PARTIAL_FILL",
      fromStatus: order.status,
      toStatus: status,
      idempotencyKey: `fill:${quoteEvidence.record.id}`,
      effectiveAtMs: BigInt(quote.marketAtMs),
      recordedAtMs: nowMs,
      reservedAfterMinor: reservedAfter,
      filledQuantityShares: filledQuantity,
      ledgerEventId: fillEvent.id,
    });
    return {
      status,
      order: loadOrder(database, order.id),
      fill,
      reasonCode: null,
      resultClass: "VERIFIED" as const,
      replayed: false,
    };
  });
}

export function cancelPaperOrder(database: AppDatabase, value: unknown) {
  const parsed = cancelOrderInputSchema.safeParse(value);
  if (!parsed.success) throw new Error("paper_order_cancel_input_invalid");
  return withTransaction(database, () => {
    const order = loadOrder(database, parsed.data.orderId);
    const idempotencyKey = `cancel:${parsed.data.idempotencyKey}`;
    const previous = database.orm
      .select()
      .from(paperOrderEvents)
      .where(eq(paperOrderEvents.orderId, order.id))
      .all()
      .find((event) => event.idempotencyKey === idempotencyKey);
    if (previous) return loadOrder(database, order.id);
    if (order.status !== "PENDING" && order.status !== "PARTIALLY_FILLED")
      throw new Error("paper_order_not_cancelable");

    const nowMs = BigInt(Date.now());
    database.orm
      .update(paperOrders)
      .set({
        reservedAmountMinor: BigInt(0),
        status: "CANCELED",
        updatedAtMs: nowMs,
      })
      .where(eq(paperOrders.id, order.id))
      .run();
    appendOrderEvent(database, order, {
      eventType: "CANCELED",
      fromStatus: order.status,
      toStatus: "CANCELED",
      idempotencyKey,
      effectiveAtMs: nowMs,
      recordedAtMs: nowMs,
      reservedAfterMinor: BigInt(0),
      filledQuantityShares: order.filledQuantityShares,
    });
    return loadOrder(database, order.id);
  });
}
