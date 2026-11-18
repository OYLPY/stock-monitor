import { asc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "@/db";
import {
  equityValuations,
  paperFills,
  paperOrderEvents,
  paperOrders,
} from "@/db/schema";
import { notionalMinor } from "@/features/paper/cost-model";
import { verifyPaperEquitySnapshot } from "@/features/risk/drawdown";
import { readPaperLedger } from "@/features/paper/ledger";

type EquityPoint = {
  asOfMs: bigint;
  equityMinor: bigint;
  source: "ACCOUNT_OPENED" | "VALUATION";
};

export type PaperLedgerAudit = {
  ledger: {
    status: "VERIFIED" | "NOT_VERIFIED";
    issueCodes: string[];
  };
  trades: Array<{
    tradeId: string;
    orderId: string;
    executedAtMs: string;
    quantityShares: string;
    priceMantissa: string;
    priceScale: number;
    currencyCode: string;
    feeMinor: string;
  }>;
  equity: {
    status: "VERIFIED" | "NOT_VERIFIED";
    issueCodes: string[];
    curve: Array<{
      asOfMs: string;
      equityMinor: string;
      source: EquityPoint["source"];
    }>;
    maximumDrawdown: {
      basisPoints: string;
      peakAtMs: string;
      peakMinor: string;
      troughAtMs: string;
      troughMinor: string;
    } | null;
  };
};

function calculateMaximumDrawdown(curve: EquityPoint[]) {
  let peak = curve[0]!;
  let worstPeak = peak;
  let worstTrough = peak;
  let largestDrop = BigInt(0);
  let largestPeak = BigInt(1);

  for (const point of curve.slice(1)) {
    if (point.equityMinor > peak.equityMinor) peak = point;
    const drop = peak.equityMinor - point.equityMinor;
    if (
      drop > BigInt(0) &&
      drop * largestPeak > largestDrop * peak.equityMinor
    ) {
      largestDrop = drop;
      largestPeak = peak.equityMinor;
      worstPeak = peak;
      worstTrough = point;
    }
  }

  return {
    basisPoints: String((largestDrop * BigInt(10_000)) / largestPeak),
    peakAtMs: String(worstPeak.asOfMs),
    peakMinor: String(worstPeak.equityMinor),
    troughAtMs: String(worstTrough.asOfMs),
    troughMinor: String(worstTrough.equityMinor),
  };
}

function auditPaperLedgerSnapshot(database: AppDatabase) {
  let ledger: ReturnType<typeof readPaperLedger>;
  try {
    ledger = readPaperLedger(database);
  } catch {
    return {
      ledger: {
        status: "NOT_VERIFIED" as const,
        issueCodes: ["LEDGER_REPLAY_FAILED"],
      },
      trades: [],
      equity: {
        status: "NOT_VERIFIED" as const,
        issueCodes: ["LEDGER_REPLAY_FAILED"],
        curve: [],
        maximumDrawdown: null,
      },
    };
  }
  if (!ledger) return null;

  const ledgerIssues = new Set<string>();
  const orders = database.orm
    .select()
    .from(paperOrders)
    .where(eq(paperOrders.accountId, ledger.account.id))
    .orderBy(asc(paperOrders.createdAtMs), asc(paperOrders.id))
    .all();
  const orderIds = orders.map(({ id }) => id);
  const fills = orderIds.length
    ? database.orm
        .select()
        .from(paperFills)
        .where(inArray(paperFills.orderId, orderIds))
        .orderBy(asc(paperFills.executedAtMs), asc(paperFills.id))
        .all()
    : [];
  const orderEvents = orderIds.length
    ? database.orm
        .select()
        .from(paperOrderEvents)
        .where(inArray(paperOrderEvents.orderId, orderIds))
        .orderBy(
          asc(paperOrderEvents.orderId),
          asc(paperOrderEvents.sequenceNo),
        )
        .all()
    : [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const eventById = new Map(ledger.events.map((event) => [event.id, event]));
  const fillByLedgerEventId = new Map(
    fills.map((fill) => [fill.ledgerEventId, fill]),
  );
  const fillTotals = new Map<
    string,
    { feesMinor: bigint; quantityShares: bigint }
  >();
  const eventsByOrder = new Map<string, typeof orderEvents>();

  for (const event of orderEvents) {
    const events = eventsByOrder.get(event.orderId) ?? [];
    events.push(event);
    eventsByOrder.set(event.orderId, events);
  }

  for (const fill of fills) {
    const order = orderById.get(fill.orderId);
    if (!order) {
      ledgerIssues.add("FILL_ORDER_MISSING");
      continue;
    }
    const total = fillTotals.get(fill.orderId) ?? {
      feesMinor: BigInt(0),
      quantityShares: BigInt(0),
    };
    total.quantityShares += fill.quantityShares;
    total.feesMinor += fill.feeMinor;
    fillTotals.set(fill.orderId, total);

    const fillEvent = eventById.get(fill.ledgerEventId);
    if (
      !fillEvent ||
      fillEvent.eventType !== "FILL" ||
      fillEvent.sourceRecordId !== fill.quoteRecordId ||
      fillEvent.effectiveAtMs !== fill.marketAtMs ||
      fillEvent.recordedAtMs !== fill.executedAtMs ||
      fillEvent.idempotencyKey !==
        `paper-fill:${fill.orderId}:${fill.quoteRecordId}` ||
      order.instrumentId !== fillEvent.positionPostings[0]?.instrumentId ||
      fill.quantityShares !== fillEvent.positionPostings[0]?.quantityShares ||
      order.currencyCode !== fill.currencyCode ||
      (fill.currencyCode !== "JPY" && fill.currencyCode !== "USD") ||
      fill.priceScale < 0 ||
      fill.priceScale > 8
    ) {
      ledgerIssues.add("FILL_LEDGER_EVENT_MISMATCH");
    } else {
      const priceAtoms =
        fill.priceMantissa * BigInt(10) ** BigInt(8 - fill.priceScale);
      const cashPosting = fillEvent.cashPostings[0];
      if (
        cashPosting?.bucket !== "SETTLED" ||
        cashPosting.currencyCode !== fill.currencyCode ||
        cashPosting.amountMinor !==
          -notionalMinor(priceAtoms, fill.quantityShares, fill.currencyCode)
      ) {
        ledgerIssues.add("FILL_CASH_MISMATCH");
      }
    }

    if (fill.feeMinor === BigInt(0)) {
      if (fill.feeLedgerEventId !== null) {
        ledgerIssues.add("FILL_FEE_EVENT_MISMATCH");
      }
    } else {
      const feeEvent = fill.feeLedgerEventId
        ? eventById.get(fill.feeLedgerEventId)
        : undefined;
      const feePosting = feeEvent?.cashPostings[0];
      if (
        !feeEvent ||
        feeEvent.eventType !== "FEE" ||
        feeEvent.effectiveAtMs !== fill.marketAtMs ||
        feeEvent.recordedAtMs !== fill.executedAtMs ||
        feeEvent.idempotencyKey !==
          `paper-fill:${fill.orderId}:${fill.quoteRecordId}:fee` ||
        feePosting?.bucket !== "SETTLED" ||
        feePosting.currencyCode !== fill.currencyCode ||
        feePosting.amountMinor !== -fill.feeMinor
      ) {
        ledgerIssues.add("FILL_FEE_EVENT_MISMATCH");
      }
    }

    const matchingOrderEvents = (eventsByOrder.get(fill.orderId) ?? []).filter(
      (event) => event.ledgerEventId === fill.ledgerEventId,
    );
    if (
      matchingOrderEvents.length !== 1 ||
      !["FILL", "PARTIAL_FILL"].includes(
        matchingOrderEvents[0]?.eventType ?? "",
      )
    ) {
      ledgerIssues.add("FILL_ORDER_EVENT_MISMATCH");
    }
  }

  for (const event of ledger.events) {
    if (event.eventType === "FILL" && !fillByLedgerEventId.has(event.id)) {
      ledgerIssues.add("ORPHAN_FILL_LEDGER_EVENT");
    }
  }

  for (const order of orders) {
    const total = fillTotals.get(order.id) ?? {
      feesMinor: BigInt(0),
      quantityShares: BigInt(0),
    };
    if (total.quantityShares !== order.filledQuantityShares) {
      ledgerIssues.add("ORDER_FILL_QUANTITY_MISMATCH");
    }
    if (total.feesMinor !== order.feesChargedMinor) {
      ledgerIssues.add("ORDER_FEE_TOTAL_MISMATCH");
    }

    const events = eventsByOrder.get(order.id) ?? [];
    if (events.length === 0) {
      ledgerIssues.add("ORDER_EVENT_MISSING");
      continue;
    }
    let previousStatus: string | null = null;
    let previousReserve: bigint | null = null;
    let filledQuantity = BigInt(0);
    for (const [index, event] of events.entries()) {
      if (
        event.sequenceNo !== BigInt(index + 1) ||
        (previousReserve !== null &&
          event.reservedBeforeMinor !== previousReserve) ||
        (index === 0 && event.fromStatus !== null) ||
        (index === 0 &&
          (event.eventType !== "SUBMITTED" || event.toStatus !== "PENDING")) ||
        (index > 0 && event.fromStatus !== previousStatus)
      ) {
        ledgerIssues.add("ORDER_EVENT_SEQUENCE_MISMATCH");
      }
      if (event.eventType === "FILL" || event.eventType === "PARTIAL_FILL") {
        const fill = event.ledgerEventId
          ? fillByLedgerEventId.get(event.ledgerEventId)
          : undefined;
        if (!fill || fill.orderId !== order.id) {
          ledgerIssues.add("FILL_ORDER_EVENT_MISMATCH");
        } else {
          filledQuantity += fill.quantityShares;
        }
      }
      if (event.filledQuantityShares !== filledQuantity) {
        ledgerIssues.add("ORDER_EVENT_FILL_QUANTITY_MISMATCH");
      }
      previousStatus = event.toStatus;
      previousReserve = event.reservedAfterMinor;
    }
    const lastEvent = events.at(-1)!;
    if (
      lastEvent.toStatus !== order.status ||
      lastEvent.reservedAfterMinor !== order.reservedAmountMinor ||
      lastEvent.filledQuantityShares !== order.filledQuantityShares
    ) {
      ledgerIssues.add("ORDER_EVENT_PROJECTION_MISMATCH");
    }
  }

  const equityIssues = new Set<string>();
  const openingEvent = ledger.events[0]!;
  const openingCash = openingEvent.cashPostings[0]!;
  const curve: EquityPoint[] = [
    {
      asOfMs: openingEvent.effectiveAtMs,
      equityMinor: openingCash.amountMinor,
      source: "ACCOUNT_OPENED",
    },
  ];
  const valuations = database.orm
    .select()
    .from(equityValuations)
    .where(eq(equityValuations.accountId, ledger.account.id))
    .orderBy(
      asc(equityValuations.asOfMs),
      asc(equityValuations.createdAtMs),
      asc(equityValuations.id),
    )
    .all();

  for (const valuation of valuations) {
    if (valuation.status !== "VERIFIED" || valuation.equityMinor === null) {
      equityIssues.add(
        valuation.status === "UNRESOLVED"
          ? "EQUITY_DATA_NOT_VERIFIED"
          : "EQUITY_VALUATION_INVALID",
      );
      continue;
    }
    if (
      valuation.currencyCode !== "JPY" ||
      valuation.currencyScale !== 0 ||
      valuation.unresolvedReason !== null ||
      !verifyPaperEquitySnapshot(database, valuation, ledger.events)
    ) {
      equityIssues.add("EQUITY_VALUATION_INVALID");
      continue;
    }
    const lastPoint = curve.at(-1)!;
    if (valuation.asOfMs < lastPoint.asOfMs) {
      equityIssues.add("EQUITY_VALUATION_ORDER_INVALID");
      continue;
    }
    if (valuation.asOfMs === lastPoint.asOfMs) {
      if (valuation.equityMinor !== lastPoint.equityMinor) {
        equityIssues.add("EQUITY_SNAPSHOT_TIME_CONFLICT");
      }
      continue;
    }
    curve.push({
      asOfMs: valuation.asOfMs,
      equityMinor: valuation.equityMinor,
      source: "VALUATION",
    });
  }

  if (valuations.length === 0) {
    equityIssues.add("EQUITY_HISTORY_NOT_ESTABLISHED");
  }
  if (curve.length < 2) {
    equityIssues.add("EQUITY_HISTORY_INSUFFICIENT");
  }
  if (ledgerIssues.size > 0) {
    equityIssues.add("LEDGER_AUDIT_FAILED");
  }
  const equityVerified = equityIssues.size === 0;
  const trades = fills
    .map((fill) => ({
      fill,
      sequenceNo: eventById.get(fill.ledgerEventId)?.sequenceNo ?? BigInt(0),
    }))
    .sort((a, b) => Number(a.sequenceNo - b.sequenceNo))
    .map(({ fill }) => ({
      tradeId: fill.id,
      orderId: fill.orderId,
      executedAtMs: String(fill.executedAtMs),
      quantityShares: String(fill.quantityShares),
      priceMantissa: String(fill.priceMantissa),
      priceScale: Number(fill.priceScale),
      currencyCode: fill.currencyCode,
      feeMinor: String(fill.feeMinor),
    }));

  return {
    ledger: {
      status:
        ledgerIssues.size === 0
          ? ("VERIFIED" as const)
          : ("NOT_VERIFIED" as const),
      issueCodes: [...ledgerIssues].sort(),
    },
    trades,
    equity: {
      status: equityVerified
        ? ("VERIFIED" as const)
        : ("NOT_VERIFIED" as const),
      issueCodes: [...equityIssues].sort(),
      curve: equityVerified
        ? curve.map((point) => ({
            asOfMs: String(point.asOfMs),
            equityMinor: String(point.equityMinor),
            source: point.source,
          }))
        : [],
      maximumDrawdown: equityVerified ? calculateMaximumDrawdown(curve) : null,
    },
  } satisfies PaperLedgerAudit;
}

export function auditPaperLedger(database: AppDatabase) {
  return database.client.transaction(() =>
    auditPaperLedgerSnapshot(database),
  )();
}
