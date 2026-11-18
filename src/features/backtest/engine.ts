import { createHash } from "node:crypto";

import { marketDateAt, parseFixedDecimal } from "@/domain/primitives";
import type { CurrencyCode, MarketCode } from "@/domain/primitives";
import type {
  OhlcvDataClass,
  VerificationStatus,
} from "@/features/quant/indicators";

const SCALE = BigInt(10) ** BigInt(8);
const BPS = BigInt(10_000);
const PRICE_IMPACT_DENOMINATOR = BigInt(20_000);
const ENGINE_VERSION = "backtest-engine-v1";

export type BacktestBar = Readonly<{
  availableAtMs: number | null;
  openPriceAvailableAtMs: number | null;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  sourceRecordId: string;
}>;

export type BacktestSession = Readonly<{
  date: string;
  openAtMs: number;
  closeAtMs: number;
  bar: BacktestBar | null;
}>;

export type BacktestCorporateAction =
  | Readonly<{
      kind: "SPLIT";
      effectiveDate: string;
      knownAtMs: number;
      ratioNumerator: string;
      ratioDenominator: string;
      sourceRecordId: string;
    }>
  | Readonly<{
      kind: "CASH_DIVIDEND";
      effectiveDate: string;
      knownAtMs: number;
      payableAtMs: number;
      grossAmountPerShare: string;
      withholdingBps: number;
      sourceRecordId: string;
    }>;

export type BacktestSignal = Readonly<{
  id: string;
  sourceDate: string;
  signalAtMs: number;
  side: "BUY" | "SELL";
  quantityShares: string;
}>;

export type BacktestCostModel = Readonly<{
  version: string;
  sourceRecordId: string;
  effectiveFromDate: string;
  effectiveThroughDate: string;
  dataClass: OhlcvDataClass;
  verificationStatus: VerificationStatus;
  // shortcut: only proportional, per-share, and fixed fees; extend for approved models that need more.
  tickSize: string;
  spreadBps: number;
  slippageBps: number;
  commissionBps: number;
  fixedFeeMinor: string;
  perShareFeeMinor: string;
  maxParticipationBps: number;
}>;
export type BacktestSettlementRule = Readonly<{
  tradeDate: string;
  settlementDate: string;
  settlementAtMs: number;
  sourceRecordId: string;
}>;

// shortcut: V1 is single-instrument and single-currency; add portfolio valuation before multi-asset runs.
export type BacktestRunInput = Readonly<{
  market: MarketCode;
  instrument: Readonly<{
    instrumentId: string;
    quoteCurrency: CurrencyCode;
    tradingUnit: string;
    sourceRecordId: string;
    dataClass: OhlcvDataClass;
    verificationStatus: VerificationStatus;
  }>;
  source: Readonly<{
    sourceId: string;
    dataClass: OhlcvDataClass;
    verificationStatus: VerificationStatus;
    executionPriceBasis: "RAW_UNADJUSTED";
  }>;
  calendar: Readonly<{
    sourceId: string;
    version: string;
    dataClass: OhlcvDataClass;
    verificationStatus: VerificationStatus;
    sessions: readonly BacktestSession[];
  }>;
  corporateActions: Readonly<{
    sourceId: string;
    dataClass: OhlcvDataClass;
    coverage: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
    verificationStatus: VerificationStatus;
    actions: readonly BacktestCorporateAction[];
  }>;
  settlementRules: Readonly<{
    sourceId: string;
    version: string;
    dataClass: OhlcvDataClass;
    verificationStatus: VerificationStatus;
    records: readonly BacktestSettlementRule[];
  }> | null;
  costModels: readonly BacktestCostModel[];
  initialCash: string;
  signals: readonly BacktestSignal[];
}>;

type OrderResult = Readonly<{
  signalId: string;
  side: "BUY" | "SELL";
  signalAtMs: number;
  executionDate: string | null;
  executedAtMs: number | null;
  priceSourceRecordId: string | null;
  costModelVersion: string | null;
  costModelSourceRecordId: string | null;
  settlementAtMs: number | null;
  settlementRuleSourceRecordId: string | null;
  requestedQuantityShares: string;
  filledQuantityShares: string;
  status: "FILLED" | "REJECTED" | "NOT_EXECUTED";
  reasonCode: string | null;
  fillPrice: string | null;
  fee: string | null;
}>;

type SessionResult = Readonly<{
  date: string;
  status: "PRESENT" | "GAP";
  verificationStatus: VerificationStatus;
  appliedCorporateActionIds: readonly string[];
  unappliedCorporateActionIds: readonly string[];
  orderSignalIds: readonly string[];
  settledCash: string;
  dividendReceivable: string;
  saleReceivable: string;
  positionShares: string;
  closeEquity: string | null;
}>;

export type BacktestRunResult = Readonly<{
  engineVersion: typeof ENGINE_VERSION;
  inputHashSha256: string;
  market: MarketCode;
  instrumentId: string;
  instrumentSourceRecordId: string;
  quoteCurrency: CurrencyCode;
  priceSourceId: string;
  corporateActionSourceId: string;
  calendarVersion: string;
  settlementRulesVersion: string | null;
  settlementRulesSourceId: string | null;
  costModelVersions: readonly Readonly<{
    version: string;
    sourceRecordId: string;
    effectiveFromDate: string;
    effectiveThroughDate: string;
  }>[];
  resultClass: "VERIFIED" | "NOT_VERIFIED" | "DEMO_ONLY";
  verificationStatus: VerificationStatus;
  verificationReasons: readonly string[];
  orders: readonly OrderResult[];
  sessions: readonly SessionResult[];
  final: Readonly<{
    settledCash: string;
    dividendReceivable: string;
    saleReceivable: string;
    positionShares: string;
    equity: string | null;
  }>;
}>;

type ParsedBar = BacktestBar & {
  openAtoms: bigint;
  highAtoms: bigint;
  lowAtoms: bigint;
  closeAtoms: bigint;
  volumeShares: bigint;
};
type ParsedSession = BacktestSession & { bar: ParsedBar | null };
type ParsedSplit = Extract<BacktestCorporateAction, { kind: "SPLIT" }> & {
  numerator: bigint;
  denominator: bigint;
};
type ParsedDividend = Extract<
  BacktestCorporateAction,
  { kind: "CASH_DIVIDEND" }
> & {
  amountAtoms: bigint;
};
type ParsedAction = ParsedSplit | ParsedDividend;
type ScheduledOrder = {
  signal: BacktestSignal;
  quantity: bigint;
  reasonCode: string | null;
};
type Receivable = { payableAtMs: number; amountMinor: bigint };
type SaleReceivable = { settlementAtMs: number; amountMinor: bigint };

function divideCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) throw new RangeError("invalid_denominator");
  if (numerator <= BigInt(0)) return numerator / denominator;
  return (numerator + denominator - BigInt(1)) / denominator;
}

function formatAtoms(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}${absolute / SCALE}.${(absolute % SCALE)
    .toString()
    .padStart(8, "0")}`;
}

function positiveAtoms(value: string, reason: string): bigint {
  const decimal = parseFixedDecimal(value);
  if (decimal.mantissa <= BigInt(0)) throw new RangeError(reason);
  return decimal.mantissa * BigInt(10) ** BigInt(8 - decimal.scale);
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("invalid_market_date");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError("invalid_market_date");
  }
  return value;
}

function requireText(
  value: string,
  reason = "missing_backtest_provenance",
): void {
  if (!value.trim()) throw new RangeError(reason);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => compareText(left, right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new RangeError("invalid_backtest_input");
  return serialized;
}

function isVerifiable(source: {
  dataClass: OhlcvDataClass;
  verificationStatus: VerificationStatus;
}): boolean {
  return (
    source.verificationStatus === "VERIFIED" &&
    (source.dataClass === "REAL" ||
      source.dataClass === "DELAYED" ||
      source.dataClass === "HISTORICAL")
  );
}

function parseBar(bar: BacktestBar): ParsedBar {
  requireText(bar.sourceRecordId);
  if (!/^\d+$/.test(bar.volume)) throw new RangeError("invalid_volume");
  const openAtoms = positiveAtoms(bar.open, "invalid_open_price");
  const highAtoms = positiveAtoms(bar.high, "invalid_high_price");
  const lowAtoms = positiveAtoms(bar.low, "invalid_low_price");
  const closeAtoms = positiveAtoms(bar.close, "invalid_close_price");
  if (
    highAtoms < openAtoms ||
    highAtoms < closeAtoms ||
    lowAtoms > openAtoms ||
    lowAtoms > closeAtoms ||
    highAtoms < lowAtoms
  ) {
    throw new RangeError("invalid_ohlcv_range");
  }
  return {
    ...bar,
    openAtoms,
    highAtoms,
    lowAtoms,
    closeAtoms,
    volumeShares: BigInt(bar.volume),
  };
}

function parseAction(action: BacktestCorporateAction): ParsedAction {
  parseDate(action.effectiveDate);
  requireText(action.sourceRecordId);
  if (!Number.isSafeInteger(action.knownAtMs) || action.knownAtMs < 0) {
    throw new RangeError("invalid_action_availability_time");
  }
  if (action.kind === "SPLIT") {
    if (
      !/^\d+$/.test(action.ratioNumerator) ||
      !/^\d+$/.test(action.ratioDenominator)
    ) {
      throw new RangeError("invalid_split_ratio");
    }
    const numerator = BigInt(action.ratioNumerator);
    const denominator = BigInt(action.ratioDenominator);
    if (numerator <= BigInt(0) || denominator <= BigInt(0)) {
      throw new RangeError("invalid_split_ratio");
    }
    return { ...action, numerator, denominator };
  }
  if (action.kind !== "CASH_DIVIDEND") {
    // shortcut: rejects unsupported actions; model one when an approved source requires it.
    throw new RangeError("unsupported_corporate_action");
  }
  if (
    !Number.isSafeInteger(action.payableAtMs) ||
    action.payableAtMs < 0 ||
    !Number.isSafeInteger(action.withholdingBps) ||
    action.withholdingBps < 0 ||
    action.withholdingBps > Number(BPS)
  ) {
    throw new RangeError("invalid_dividend_terms");
  }
  return {
    ...action,
    amountAtoms: positiveAtoms(
      action.grossAmountPerShare,
      "invalid_dividend_amount",
    ),
  };
}

function parseCostModel(model: BacktestCostModel) {
  requireText(model.version);
  requireText(model.sourceRecordId);
  parseDate(model.effectiveFromDate);
  parseDate(model.effectiveThroughDate);
  for (const value of [
    model.spreadBps,
    model.slippageBps,
    model.commissionBps,
    model.maxParticipationBps,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("invalid_cost_model");
    }
  }
  if (
    model.maxParticipationBps < 1 ||
    model.maxParticipationBps > Number(BPS) ||
    model.commissionBps >= Number(BPS) ||
    BigInt(model.spreadBps) + BigInt(2) * BigInt(model.slippageBps) >=
      PRICE_IMPACT_DENOMINATOR ||
    !/^\d{1,18}$/.test(model.fixedFeeMinor) ||
    !/^\d{1,18}$/.test(model.perShareFeeMinor) ||
    model.effectiveFromDate > model.effectiveThroughDate
  ) {
    throw new RangeError("invalid_cost_model");
  }
  if (!isVerifiable(model) && model.verificationStatus === "VERIFIED") {
    throw new RangeError("unverified_cost_class_cannot_be_verified");
  }
  const tickAtoms = positiveAtoms(model.tickSize, "invalid_tick_size");
  const fixedFeeMinor = BigInt(model.fixedFeeMinor);
  const perShareFeeMinor = BigInt(model.perShareFeeMinor);
  return { ...model, tickAtoms, fixedFeeMinor, perShareFeeMinor };
}

function parseSettlementRule(
  rule: BacktestSettlementRule,
  market: MarketCode,
): BacktestSettlementRule {
  parseDate(rule.tradeDate);
  parseDate(rule.settlementDate);
  requireText(rule.sourceRecordId);
  if (
    !Number.isSafeInteger(rule.settlementAtMs) ||
    rule.settlementAtMs < 0 ||
    marketDateAt(rule.settlementAtMs, market) !== rule.settlementDate ||
    rule.settlementDate < rule.tradeDate
  ) {
    throw new RangeError("invalid_settlement_rule");
  }
  return rule;
}

function currencyScale(currency: CurrencyCode): number {
  return currency === "JPY" ? 0 : 2;
}

function toMinor(
  atoms: bigint,
  currency: CurrencyCode,
  roundUp: boolean,
): bigint {
  const scale = currencyScale(currency);
  const numerator = atoms * BigInt(10) ** BigInt(scale);
  return roundUp ? divideCeil(numerator, SCALE) : numerator / SCALE;
}

function minorToAtoms(minor: bigint, currency: CurrencyCode): bigint {
  return minor * BigInt(10) ** BigInt(8 - currencyScale(currency));
}

function initialCashMinor(value: string, currency: CurrencyCode): bigint {
  const decimal = parseFixedDecimal(value);
  const scale = currencyScale(currency);
  if (
    decimal.mantissa < BigInt(0) ||
    (decimal.scale > scale &&
      decimal.mantissa % BigInt(10) ** BigInt(decimal.scale - scale) !==
        BigInt(0))
  ) {
    throw new RangeError("invalid_initial_cash");
  }
  return (
    decimal.mantissa * BigInt(10) ** BigInt(Math.max(0, scale - decimal.scale))
  );
}

function roundedToTick(value: bigint, tick: bigint, roundUp: boolean): bigint {
  const ticks = roundUp ? divideCeil(value, tick) : value / tick;
  return ticks * tick;
}

function fillPrice(
  openAtoms: bigint,
  side: "BUY" | "SELL",
  costModel: NonNullable<ReturnType<typeof parseCostModel>>,
): bigint {
  const impactNumerator =
    BigInt(costModel.spreadBps) + BigInt(2) * BigInt(costModel.slippageBps);
  const adjustment =
    side === "BUY"
      ? divideCeil(
          openAtoms * (PRICE_IMPACT_DENOMINATOR + impactNumerator),
          PRICE_IMPACT_DENOMINATOR,
        )
      : (openAtoms * (PRICE_IMPACT_DENOMINATOR - impactNumerator)) /
        PRICE_IMPACT_DENOMINATOR;
  return roundedToTick(adjustment, costModel.tickAtoms, side === "BUY");
}

function feeMinor(
  notionalMinor: bigint,
  quantityShares: bigint,
  costModel: NonNullable<ReturnType<typeof parseCostModel>>,
): bigint {
  return (
    divideCeil(notionalMinor * BigInt(costModel.commissionBps), BPS) +
    costModel.fixedFeeMinor +
    quantityShares * costModel.perShareFeeMinor
  );
}

function actionOrder(left: ParsedAction, right: ParsedAction): number {
  return (
    compareText(left.effectiveDate, right.effectiveDate) ||
    (left.kind === right.kind ? 0 : left.kind === "SPLIT" ? -1 : 1) ||
    compareText(left.sourceRecordId, right.sourceRecordId)
  );
}

export function runBacktest(input: BacktestRunInput): BacktestRunResult {
  requireText(input.instrument.instrumentId);
  requireText(input.instrument.sourceRecordId);
  requireText(input.source.sourceId);
  if (input.source.executionPriceBasis !== "RAW_UNADJUSTED") {
    throw new RangeError("execution_prices_must_be_raw_unadjusted");
  }
  requireText(input.calendar.sourceId);
  requireText(input.calendar.version);
  requireText(input.corporateActions.sourceId);
  if (input.settlementRules) {
    requireText(input.settlementRules.sourceId);
    requireText(input.settlementRules.version);
  }
  if (
    !isVerifiable(input.instrument) &&
    input.instrument.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_instrument_cannot_be_verified");
  }
  if (
    !isVerifiable(input.source) &&
    input.source.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_price_source_cannot_be_verified");
  }
  if (
    !isVerifiable(input.calendar) &&
    input.calendar.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_calendar_cannot_be_verified");
  }
  if (
    input.settlementRules &&
    !isVerifiable(input.settlementRules) &&
    input.settlementRules.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_settlement_rules_cannot_be_verified");
  }
  if (
    !isVerifiable(input.corporateActions) &&
    input.corporateActions.verificationStatus === "VERIFIED"
  ) {
    throw new RangeError("unverified_action_source_cannot_be_verified");
  }
  if (
    !/^\d+$/.test(input.instrument.tradingUnit) ||
    BigInt(input.instrument.tradingUnit) <= BigInt(0)
  ) {
    throw new RangeError("invalid_trading_unit");
  }
  const tradingUnit = BigInt(input.instrument.tradingUnit);
  if (
    (input.market === "JP" && input.instrument.quoteCurrency !== "JPY") ||
    (input.market === "US" && input.instrument.quoteCurrency !== "USD")
  ) {
    throw new RangeError("market_currency_mismatch");
  }
  const cash = initialCashMinor(
    input.initialCash,
    input.instrument.quoteCurrency,
  );
  if (cash <= BigInt(0)) throw new RangeError("invalid_initial_cash");
  if (input.calendar.sessions.length === 0)
    throw new RangeError("empty_backtest_calendar");

  const sessions: ParsedSession[] = [];
  const barRecordIds = new Set<string>();
  for (const [index, session] of input.calendar.sessions.entries()) {
    parseDate(session.date);
    if (
      !Number.isSafeInteger(session.openAtMs) ||
      !Number.isSafeInteger(session.closeAtMs) ||
      session.openAtMs < 0 ||
      session.openAtMs >= session.closeAtMs ||
      marketDateAt(session.openAtMs, input.market) !== session.date ||
      marketDateAt(session.closeAtMs, input.market) !== session.date ||
      (index > 0 &&
        (input.calendar.sessions[index - 1].date >= session.date ||
          input.calendar.sessions[index - 1].closeAtMs >= session.openAtMs))
    ) {
      throw new RangeError("invalid_backtest_session");
    }
    let bar: ParsedBar | null = null;
    if (session.bar) {
      bar = parseBar(session.bar);
      if (barRecordIds.has(bar.sourceRecordId)) {
        throw new RangeError("duplicate_bar_record");
      }
      if (
        bar.availableAtMs !== null &&
        (!Number.isSafeInteger(bar.availableAtMs) ||
          bar.availableAtMs < session.closeAtMs)
      ) {
        throw new RangeError("invalid_bar_availability_time");
      }
      if (
        bar.openPriceAvailableAtMs !== null &&
        (!Number.isSafeInteger(bar.openPriceAvailableAtMs) ||
          bar.openPriceAvailableAtMs < session.openAtMs)
      ) {
        throw new RangeError("invalid_open_price_availability_time");
      }
      barRecordIds.add(bar.sourceRecordId);
    }
    sessions.push({ ...session, bar });
  }

  const sessionIndexByDate = new Map(
    sessions.map(({ date }, index) => [date, index] as const),
  );
  const actionRecordIds = new Set<string>();
  const actions = input.corporateActions.actions
    .map(parseAction)
    .sort(actionOrder);
  const actionsByIndex = new Map<number, ParsedAction[]>();
  for (const action of actions) {
    if (actionRecordIds.has(action.sourceRecordId)) {
      throw new RangeError("duplicate_action_record");
    }
    actionRecordIds.add(action.sourceRecordId);
    const index = sessionIndexByDate.get(action.effectiveDate);
    if (index === undefined)
      throw new RangeError("action_outside_backtest_calendar");
    if (
      action.kind === "CASH_DIVIDEND" &&
      action.payableAtMs < sessions[index].closeAtMs
    ) {
      throw new RangeError("invalid_dividend_payable_time");
    }
    const sameDayActions = actionsByIndex.get(index) ?? [];
    sameDayActions.push(action);
    actionsByIndex.set(index, sameDayActions);
  }

  const settlementRulesByDate = new Map<string, BacktestSettlementRule>();
  for (const rawRule of input.settlementRules?.records ?? []) {
    const rule = parseSettlementRule(rawRule, input.market);
    if (settlementRulesByDate.has(rule.tradeDate)) {
      throw new RangeError("duplicate_settlement_rule");
    }
    const tradeSessionIndex = sessionIndexByDate.get(rule.tradeDate);
    if (
      tradeSessionIndex !== undefined &&
      rule.settlementAtMs < sessions[tradeSessionIndex].closeAtMs
    ) {
      throw new RangeError("invalid_settlement_rule");
    }
    settlementRulesByDate.set(rule.tradeDate, rule);
  }

  const costModels = input.costModels
    .map(parseCostModel)
    .sort((left, right) =>
      compareText(left.effectiveFromDate, right.effectiveFromDate),
    );
  const costModelSourceRecordIds = new Set<string>();
  for (const model of costModels) {
    if (costModelSourceRecordIds.has(model.sourceRecordId)) {
      throw new RangeError("duplicate_cost_model_source_record");
    }
    costModelSourceRecordIds.add(model.sourceRecordId);
  }
  for (let index = 1; index < costModels.length; index += 1) {
    if (
      costModels[index].effectiveFromDate <=
      costModels[index - 1].effectiveThroughDate
    ) {
      throw new RangeError("overlapping_cost_model_periods");
    }
  }
  const costModelByDate = new Map<string, ReturnType<typeof parseCostModel>>();
  for (const { date } of sessions) {
    const model = costModels.find(
      ({ effectiveFromDate, effectiveThroughDate }) =>
        date >= effectiveFromDate && date <= effectiveThroughDate,
    );
    if (model) costModelByDate.set(date, model);
  }
  const usedCostModels = costModels.filter((model) =>
    sessions.some(
      ({ date }) =>
        date >= model.effectiveFromDate && date <= model.effectiveThroughDate,
    ),
  );
  const signals = [...input.signals];
  for (const signal of signals) requireText(signal.id, "missing_signal_id");
  signals.sort(
    (left, right) =>
      (left.signalAtMs < right.signalAtMs
        ? -1
        : left.signalAtMs > right.signalAtMs
          ? 1
          : 0) || compareText(left.id, right.id),
  );
  const signalIds = new Set<string>();
  const scheduledOrders = new Map<number, ScheduledOrder[]>();
  const orderResults = new Map<string, OrderResult>();
  const verificationReasons = new Set<string>();
  const appliedActions = new Set<string>();
  const receivables: Receivable[] = [];
  const saleReceivables: SaleReceivable[] = [];
  let settledCash = cash;
  let positionShares = BigInt(0);
  let tradingBlocked = false;
  let pathVerified = true;

  if (!isVerifiable(input.instrument))
    verificationReasons.add("UNVERIFIED_INSTRUMENT");
  if (!isVerifiable(input.source))
    verificationReasons.add("UNVERIFIED_PRICE_SOURCE");
  if (!isVerifiable(input.calendar))
    verificationReasons.add("UNVERIFIED_CALENDAR");
  if (
    !isVerifiable(input.corporateActions) ||
    input.corporateActions.coverage !== "COMPLETE"
  ) {
    verificationReasons.add("UNVERIFIED_CORPORATE_ACTION_COVERAGE");
  }
  if (!input.settlementRules) {
    verificationReasons.add("SETTLEMENT_RULES_UNAVAILABLE");
  } else if (!isVerifiable(input.settlementRules)) {
    verificationReasons.add("UNVERIFIED_SETTLEMENT_RULES");
  }
  if (costModels.length === 0) {
    verificationReasons.add("COST_MODEL_UNAVAILABLE");
  } else if (usedCostModels.some((model) => !isVerifiable(model))) {
    verificationReasons.add("UNVERIFIED_COST_MODEL");
  }
  if (sessions.some(({ date }) => !costModelByDate.has(date))) {
    verificationReasons.add("COST_MODEL_MISSING_FOR_SESSION");
  }

  for (const signal of signals) {
    requireText(signal.id, "missing_signal_id");
    if (signalIds.has(signal.id)) throw new RangeError("duplicate_signal_id");
    signalIds.add(signal.id);
    if (
      !Number.isSafeInteger(signal.signalAtMs) ||
      signal.signalAtMs < 0 ||
      (signal.side !== "BUY" && signal.side !== "SELL") ||
      !/^\d+$/.test(signal.quantityShares) ||
      BigInt(signal.quantityShares) <= BigInt(0) ||
      BigInt(signal.quantityShares) % tradingUnit !== BigInt(0)
    ) {
      throw new RangeError("invalid_backtest_signal");
    }
    const sourceIndex = sessionIndexByDate.get(signal.sourceDate);
    if (sourceIndex === undefined)
      throw new RangeError("signal_source_outside_calendar");
    const sourceSession = sessions[sourceIndex];
    if (signal.signalAtMs < sourceSession.closeAtMs) {
      throw new RangeError("signal_precedes_source_bar_close");
    }
    if (!sourceSession.bar) {
      orderResults.set(signal.id, {
        signalId: signal.id,
        side: signal.side,
        signalAtMs: signal.signalAtMs,
        executionDate: null,
        executedAtMs: null,
        priceSourceRecordId: null,
        costModelVersion: null,
        costModelSourceRecordId: null,
        settlementAtMs: null,
        settlementRuleSourceRecordId: null,
        requestedQuantityShares: signal.quantityShares,
        filledQuantityShares: "0",
        status: "NOT_EXECUTED",
        reasonCode: "SIGNAL_SOURCE_BAR_MISSING",
        fillPrice: null,
        fee: null,
      });
      verificationReasons.add("SIGNAL_SOURCE_BAR_MISSING");
      pathVerified = false;
      continue;
    }
    if (sourceSession.bar.availableAtMs === null) {
      orderResults.set(signal.id, {
        signalId: signal.id,
        side: signal.side,
        signalAtMs: signal.signalAtMs,
        executionDate: null,
        executedAtMs: null,
        priceSourceRecordId: null,
        costModelVersion: null,
        costModelSourceRecordId: null,
        settlementAtMs: null,
        settlementRuleSourceRecordId: null,
        requestedQuantityShares: signal.quantityShares,
        filledQuantityShares: "0",
        status: "NOT_EXECUTED",
        reasonCode: "SIGNAL_SOURCE_AVAILABILITY_UNKNOWN",
        fillPrice: null,
        fee: null,
      });
      verificationReasons.add("BAR_AVAILABILITY_UNKNOWN");
      pathVerified = false;
      continue;
    }
    if (signal.signalAtMs < sourceSession.bar.availableAtMs) {
      throw new RangeError("signal_precedes_source_bar_availability");
    }
    let low = 0;
    let high = sessions.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sessions[middle].openAtMs > signal.signalAtMs) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    const targetIndex = low < sessions.length ? low : -1;
    if (targetIndex === -1) {
      verificationReasons.add("NO_NEXT_SESSION");
      orderResults.set(signal.id, {
        signalId: signal.id,
        side: signal.side,
        signalAtMs: signal.signalAtMs,
        executionDate: null,
        executedAtMs: null,
        priceSourceRecordId: null,
        costModelVersion: null,
        costModelSourceRecordId: null,
        settlementAtMs: null,
        settlementRuleSourceRecordId: null,
        requestedQuantityShares: signal.quantityShares,
        filledQuantityShares: "0",
        status: "NOT_EXECUTED",
        reasonCode: "NO_NEXT_SESSION",
        fillPrice: null,
        fee: null,
      });
      continue;
    }
    const scheduled = scheduledOrders.get(targetIndex) ?? [];
    scheduled.push({
      signal,
      quantity: BigInt(signal.quantityShares),
      reasonCode: null,
    });
    scheduledOrders.set(targetIndex, scheduled);
  }

  const settleReceivables = (atMs: number) => {
    for (let index = receivables.length - 1; index >= 0; index -= 1) {
      if (receivables[index].payableAtMs <= atMs) {
        settledCash += receivables[index].amountMinor;
        receivables.splice(index, 1);
      }
    }
  };
  const settleSaleReceivables = (atMs: number) => {
    for (let index = saleReceivables.length - 1; index >= 0; index -= 1) {
      if (saleReceivables[index].settlementAtMs <= atMs) {
        settledCash += saleReceivables[index].amountMinor;
        saleReceivables.splice(index, 1);
      }
    }
  };
  const receivableMinor = () =>
    receivables.reduce(
      (total, receivable) => total + receivable.amountMinor,
      BigInt(0),
    );
  const saleReceivableMinor = () =>
    saleReceivables.reduce(
      (total, receivable) => total + receivable.amountMinor,
      BigInt(0),
    );

  const resultsByDate = new Map<string, SessionResult>();
  for (const [index, session] of sessions.entries()) {
    settleSaleReceivables(session.openAtMs);
    settleReceivables(session.openAtMs);
    let sessionParticipationShares = BigInt(0);
    const appliedCorporateActionIds: string[] = [];
    const unappliedCorporateActionIds: string[] = [];
    for (const action of actionsByIndex.get(index) ?? []) {
      if (appliedActions.has(action.sourceRecordId)) continue;
      if (tradingBlocked) {
        appliedActions.add(action.sourceRecordId);
        unappliedCorporateActionIds.push(action.sourceRecordId);
        continue;
      }
      if (action.knownAtMs >= session.openAtMs) {
        appliedActions.add(action.sourceRecordId);
        verificationReasons.add("LATE_CORPORATE_ACTION");
        pathVerified = false;
        if (action.kind === "SPLIT") tradingBlocked = true;
        unappliedCorporateActionIds.push(action.sourceRecordId);
        continue;
      }
      if (action.kind === "SPLIT") {
        const nextPositionNumerator = positionShares * action.numerator;
        if (nextPositionNumerator % action.denominator !== BigInt(0)) {
          tradingBlocked = true;
          verificationReasons.add("FRACTIONAL_SPLIT_POSITION_UNSUPPORTED");
          pathVerified = false;
          appliedActions.add(action.sourceRecordId);
          unappliedCorporateActionIds.push(action.sourceRecordId);
          continue;
        }
        positionShares = nextPositionNumerator / action.denominator;
        for (const [targetIndex, orders] of scheduledOrders) {
          if (targetIndex < index) continue;
          for (const order of orders) {
            if (order.signal.sourceDate >= action.effectiveDate) continue;
            const numerator = order.quantity * action.numerator;
            if (numerator % action.denominator !== BigInt(0)) {
              order.reasonCode = "FRACTIONAL_SPLIT_ORDER_UNSUPPORTED";
            } else {
              order.quantity = numerator / action.denominator;
            }
          }
        }
        appliedCorporateActionIds.push(action.sourceRecordId);
        appliedActions.add(action.sourceRecordId);
      } else {
        const grossMinor = toMinor(
          action.amountAtoms * positionShares,
          input.instrument.quoteCurrency,
          false,
        );
        const withheldMinor = divideCeil(
          grossMinor * BigInt(action.withholdingBps),
          BPS,
        );
        const netMinor = grossMinor - withheldMinor;
        if (netMinor > BigInt(0)) {
          receivables.push({
            payableAtMs: action.payableAtMs,
            amountMinor: netMinor,
          });
        }
        appliedCorporateActionIds.push(action.sourceRecordId);
        appliedActions.add(action.sourceRecordId);
      }
    }

    const sessionCostModel = costModelByDate.get(session.date) ?? null;
    const executedSignalIds: string[] = [];
    const dueOrders = scheduledOrders.get(index) ?? [];
    dueOrders.sort(
      (left, right) =>
        (left.signal.signalAtMs < right.signal.signalAtMs
          ? -1
          : left.signal.signalAtMs > right.signal.signalAtMs
            ? 1
            : 0) || compareText(left.signal.id, right.signal.id),
    );
    for (const order of dueOrders) {
      const { signal } = order;
      const noExecution = (
        reasonCode: string,
        status: OrderResult["status"] = "NOT_EXECUTED",
      ) => {
        orderResults.set(signal.id, {
          signalId: signal.id,
          side: signal.side,
          signalAtMs: signal.signalAtMs,
          executionDate: session.date,
          executedAtMs: null,
          priceSourceRecordId: null,
          costModelVersion: null,
          costModelSourceRecordId: null,
          settlementAtMs: null,
          settlementRuleSourceRecordId: null,
          requestedQuantityShares: signal.quantityShares,
          filledQuantityShares: "0",
          status,
          reasonCode,
          fillPrice: null,
          fee: null,
        });
      };
      if (!session.bar) {
        noExecution("NEXT_SESSION_DATA_GAP");
        verificationReasons.add("MISSING_SESSION_BAR");
        pathVerified = false;
        continue;
      }
      if (session.bar.openPriceAvailableAtMs !== session.openAtMs) {
        noExecution("OPEN_PRICE_UNAVAILABLE_AT_OPEN");
        verificationReasons.add("OPEN_PRICE_UNAVAILABLE_AT_OPEN");
        pathVerified = false;
        continue;
      }
      if (order.reasonCode) {
        noExecution(order.reasonCode);
        verificationReasons.add(order.reasonCode);
        pathVerified = false;
        continue;
      }
      if (tradingBlocked) {
        noExecution("CORPORATE_ACTION_POSITION_UNSUPPORTED");
        continue;
      }
      if (!sessionCostModel) {
        noExecution(
          costModels.length === 0
            ? "COST_MODEL_UNAVAILABLE"
            : "COST_MODEL_OUTSIDE_EFFECTIVE_PERIOD",
        );
        verificationReasons.add("COST_MODEL_MISSING_FOR_SESSION");
        pathVerified = false;
        continue;
      }
      const settlementRule = settlementRulesByDate.get(session.date);
      if (signal.side === "SELL" && !settlementRule) {
        noExecution("SETTLEMENT_RULE_MISSING");
        verificationReasons.add("SETTLEMENT_RULE_MISSING");
        pathVerified = false;
        continue;
      }
      const allowedShares =
        (session.bar.volumeShares *
          BigInt(sessionCostModel.maxParticipationBps)) /
        BPS;
      if (order.quantity > allowedShares - sessionParticipationShares) {
        noExecution("INSUFFICIENT_BAR_LIQUIDITY", "REJECTED");
        continue;
      }
      if (order.quantity % tradingUnit !== BigInt(0)) {
        noExecution("INVALID_TRADING_UNIT", "REJECTED");
        continue;
      }
      if (signal.side === "SELL" && order.quantity > positionShares) {
        noExecution("INSUFFICIENT_POSITION", "REJECTED");
        continue;
      }

      const priceAtoms = fillPrice(
        session.bar.openAtoms,
        signal.side,
        sessionCostModel,
      );
      if (priceAtoms <= BigInt(0)) {
        noExecution("INVALID_FILL_PRICE", "REJECTED");
        verificationReasons.add("INVALID_FILL_PRICE");
        pathVerified = false;
        continue;
      }
      const notionalMinor = toMinor(
        priceAtoms * order.quantity,
        input.instrument.quoteCurrency,
        signal.side === "BUY",
      );
      const fee = feeMinor(notionalMinor, order.quantity, sessionCostModel);
      if (signal.side === "BUY") {
        if (notionalMinor + fee > settledCash) {
          noExecution("INSUFFICIENT_CASH", "REJECTED");
          continue;
        }
        settledCash -= notionalMinor + fee;
        positionShares += order.quantity;
      } else {
        if (fee > notionalMinor) {
          noExecution("COST_EXCEEDS_PROCEEDS", "REJECTED");
          continue;
        }
        saleReceivables.push({
          settlementAtMs: settlementRule!.settlementAtMs,
          amountMinor: notionalMinor - fee,
        });
        positionShares -= order.quantity;
      }
      sessionParticipationShares += order.quantity;
      executedSignalIds.push(signal.id);
      orderResults.set(signal.id, {
        signalId: signal.id,
        side: signal.side,
        signalAtMs: signal.signalAtMs,
        executionDate: session.date,
        executedAtMs: session.openAtMs,
        priceSourceRecordId: session.bar.sourceRecordId,
        costModelVersion: sessionCostModel!.version,
        costModelSourceRecordId: sessionCostModel!.sourceRecordId,
        settlementAtMs:
          signal.side === "SELL" ? settlementRule!.settlementAtMs : null,
        settlementRuleSourceRecordId:
          signal.side === "SELL" ? settlementRule!.sourceRecordId : null,
        requestedQuantityShares: signal.quantityShares,
        filledQuantityShares: order.quantity.toString(),
        status: "FILLED",
        reasonCode: null,
        fillPrice: formatAtoms(priceAtoms),
        fee: formatAtoms(minorToAtoms(fee, input.instrument.quoteCurrency)),
      });
    }

    settleSaleReceivables(session.closeAtMs);
    settleReceivables(session.closeAtMs);
    const sessionVerified =
      isVerifiable(input.instrument) &&
      isVerifiable(input.source) &&
      isVerifiable(input.calendar) &&
      input.corporateActions.coverage === "COMPLETE" &&
      isVerifiable(input.corporateActions) &&
      input.settlementRules !== null &&
      isVerifiable(input.settlementRules) &&
      sessionCostModel !== null &&
      isVerifiable(sessionCostModel) &&
      pathVerified &&
      session.bar !== null &&
      session.bar.availableAtMs !== null &&
      session.bar.openPriceAvailableAtMs === session.openAtMs &&
      !tradingBlocked;
    if (!session.bar) {
      verificationReasons.add("MISSING_SESSION_BAR");
      pathVerified = false;
    }
    if (session.bar?.availableAtMs === null) {
      verificationReasons.add("BAR_AVAILABILITY_UNKNOWN");
      pathVerified = false;
    }
    const closeEquity =
      session.bar && !tradingBlocked
        ? formatAtoms(
            minorToAtoms(
              settledCash + receivableMinor() + saleReceivableMinor(),
              input.instrument.quoteCurrency,
            ) +
              session.bar.closeAtoms * positionShares,
          )
        : null;
    resultsByDate.set(session.date, {
      date: session.date,
      status: session.bar ? "PRESENT" : "GAP",
      verificationStatus: sessionVerified ? "VERIFIED" : "NOT_VERIFIED",
      appliedCorporateActionIds,
      unappliedCorporateActionIds,
      orderSignalIds: executedSignalIds,
      settledCash: formatAtoms(
        minorToAtoms(settledCash, input.instrument.quoteCurrency),
      ),
      dividendReceivable: formatAtoms(
        minorToAtoms(receivableMinor(), input.instrument.quoteCurrency),
      ),
      saleReceivable: formatAtoms(
        minorToAtoms(saleReceivableMinor(), input.instrument.quoteCurrency),
      ),
      positionShares: positionShares.toString(),
      closeEquity,
    });
  }

  const orderedResults = signals.map(
    (signal) =>
      orderResults.get(signal.id) ?? {
        signalId: signal.id,
        side: signal.side,
        signalAtMs: signal.signalAtMs,
        executionDate: null,
        executedAtMs: null,
        priceSourceRecordId: null,
        costModelVersion: null,
        costModelSourceRecordId: null,
        settlementAtMs: null,
        settlementRuleSourceRecordId: null,
        requestedQuantityShares: signal.quantityShares,
        filledQuantityShares: "0",
        status: "NOT_EXECUTED" as const,
        reasonCode: "NO_NEXT_SESSION",
        fillPrice: null,
        fee: null,
      },
  );
  if (sessions.some(({ bar }) => bar === null || bar.availableAtMs === null)) {
    verificationReasons.add("INCOMPLETE_OR_UNTIMED_BARS");
  }
  if (
    sessions.some(
      ({ openAtMs, bar }) =>
        bar !== null && bar.openPriceAvailableAtMs !== openAtMs,
    )
  ) {
    verificationReasons.add("OPEN_PRICE_AVAILABILITY_UNKNOWN_OR_LATE");
  }
  if (tradingBlocked) {
    verificationReasons.add("CORPORATE_ACTION_POSITION_UNSUPPORTED");
  }

  const finalSession = resultsByDate.get(sessions.at(-1)!.date)!;
  const verificationStatus: VerificationStatus =
    verificationReasons.size === 0 ? "VERIFIED" : "NOT_VERIFIED";
  const containsFixture =
    input.instrument.dataClass === "FIXTURE" ||
    input.source.dataClass === "FIXTURE" ||
    input.corporateActions.dataClass === "FIXTURE" ||
    input.calendar.dataClass === "FIXTURE" ||
    input.settlementRules?.dataClass === "FIXTURE" ||
    usedCostModels.some((model) => model.dataClass === "FIXTURE");
  return {
    engineVersion: ENGINE_VERSION,
    inputHashSha256: createHash("sha256")
      .update(stableJson(input))
      .digest("hex"),
    market: input.market,
    instrumentId: input.instrument.instrumentId,
    instrumentSourceRecordId: input.instrument.sourceRecordId,
    quoteCurrency: input.instrument.quoteCurrency,
    priceSourceId: input.source.sourceId,
    corporateActionSourceId: input.corporateActions.sourceId,
    calendarVersion: input.calendar.version,
    settlementRulesVersion: input.settlementRules?.version ?? null,
    settlementRulesSourceId: input.settlementRules?.sourceId ?? null,
    costModelVersions: usedCostModels.map(
      ({
        version,
        sourceRecordId,
        effectiveFromDate,
        effectiveThroughDate,
      }) => ({
        version,
        sourceRecordId,
        effectiveFromDate,
        effectiveThroughDate,
      }),
    ),
    resultClass: containsFixture ? "DEMO_ONLY" : verificationStatus,
    verificationStatus,
    verificationReasons: [...verificationReasons].sort(),
    orders: orderedResults,
    sessions: sessions.map(({ date }) => resultsByDate.get(date)!),
    final: {
      settledCash: finalSession.settledCash,
      dividendReceivable: finalSession.dividendReceivable,
      saleReceivable: finalSession.saleReceivable,
      positionShares: finalSession.positionShares,
      equity: finalSession.closeEquity,
    },
  };
}
