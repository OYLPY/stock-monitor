import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { withTransaction, type AppDatabase } from "@/db";
import {
  equityValuationEvidence,
  equityValuationMarketEvidence,
  equityValuations,
  instruments,
} from "@/db/schema";
import {
  convertMoney,
  parseFixedDecimal,
  parseFxRate,
} from "@/domain/primitives";
import {
  paperLedgerInputHash,
  readPaperLedger,
  replayPaperLedger,
  type PaperLedgerEvent,
} from "@/features/paper/ledger";
import { getSourceEvidence, sourceEvidenceInputSchema } from "./evidence";

const timestampSchema = z.number().int().nonnegative().safe();
const decimalSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/);
const positionQuotePayloadSchema = z.strictObject({
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

export const equityMarketEvidenceInputSchema = z.discriminatedUnion("role", [
  sourceEvidenceInputSchema.extend({
    role: z.literal("POSITION_QUOTE"),
    instrumentId: z.uuid(),
  }),
  sourceEvidenceInputSchema.extend({ role: z.literal("FX_RATE") }),
]);

type EquityMarketEvidenceInput = z.infer<
  typeof equityMarketEvidenceInputSchema
>;
type MarketEvidence =
  | {
      role: "POSITION_QUOTE";
      instrumentId: string;
      sourceRecordId: string;
      contentHashSha256: string;
      payload: z.infer<typeof positionQuotePayloadSchema>;
    }
  | {
      role: "FX_RATE";
      sourceRecordId: string;
      contentHashSha256: string;
      payload: z.infer<typeof fxPayloadSchema>;
    };

type PaperEquityInput = {
  asOfMs: bigint;
  cashBalances: Array<{
    currencyCode: "JPY" | "USD";
    settled: bigint;
    receivable: bigint;
    payable: bigint;
  }>;
  positions: Array<{
    instrumentId: string;
    quantityShares: bigint;
    quoteCurrencyCode: "JPY" | "USD";
    classificationStatus: "VERIFIED" | "NOT_VERIFIED";
  }>;
  marketEvidence: MarketEvidence[];
};

const equityRuleVersion = "equity-market-v2";
const maxSqliteInteger = (BigInt(1) << BigInt(63)) - BigInt(1);

function validPeriod(
  validFromMs: number,
  validUntilMs: number,
  marketAtMs: number,
  asOfMs: bigint,
) {
  return (
    validFromMs <= validUntilMs &&
    BigInt(validFromMs) <= asOfMs &&
    asOfMs <= BigInt(validUntilMs) &&
    BigInt(marketAtMs) <= asOfMs
  );
}

function marketValueMinor(
  price: string,
  shares: bigint,
  currency: "JPY" | "USD",
) {
  const { mantissa, scale } = parseFixedDecimal(price);
  const minorScale = currency === "JPY" ? 0 : 2;
  const numerator = mantissa * shares * BigInt(10) ** BigInt(minorScale);
  const denominator = BigInt(10) ** BigInt(scale);
  return numerator / denominator;
}

export function calculatePaperEquity(input: PaperEquityInput) {
  let equityMinor = BigInt(0);
  for (const balance of input.cashBalances) {
    const amountMinor = balance.settled + balance.receivable + balance.payable;
    if (balance.currencyCode === "JPY") equityMinor += amountMinor;
  }

  const usdCash = input.cashBalances.reduce(
    (total, balance) =>
      balance.currencyCode === "USD"
        ? total + balance.settled + balance.receivable + balance.payable
        : total,
    BigInt(0),
  );
  const needsFx =
    usdCash !== BigInt(0) ||
    input.positions.some((position) => position.quoteCurrencyCode === "USD");
  let fxRate: ReturnType<typeof parseFxRate> | null = null;
  if (needsFx) {
    const fxEvidence = input.marketEvidence.filter(
      (candidate) => candidate.role === "FX_RATE",
    );
    if (fxEvidence.length !== 1) {
      return {
        status: "UNRESOLVED" as const,
        equityMinor: null,
        unresolvedReason: "fx_rate_unavailable",
      };
    }
    const fx = fxPayloadSchema.safeParse(fxEvidence[0].payload);
    if (
      !fx.success ||
      !/^[0-9a-f]{64}$/.test(fxEvidence[0].contentHashSha256) ||
      parseFixedDecimal(fx.data.rate).mantissa <= BigInt(0) ||
      !validPeriod(
        fx.data.validFromMs,
        fx.data.validUntilMs,
        fx.data.marketAtMs,
        input.asOfMs,
      )
    ) {
      return {
        status: "UNRESOLVED" as const,
        equityMinor: null,
        unresolvedReason: "fx_rate_unavailable",
      };
    }
    fxRate = parseFxRate("USD", "JPY", fx.data.rate);
  }

  for (const position of input.positions) {
    const marks = input.marketEvidence.filter(
      (evidence) =>
        evidence.role === "POSITION_QUOTE" &&
        evidence.instrumentId === position.instrumentId,
    );
    if (
      position.classificationStatus !== "VERIFIED" ||
      position.quantityShares <= BigInt(0) ||
      marks.length !== 1
    ) {
      return {
        status: "UNRESOLVED" as const,
        equityMinor: null,
        unresolvedReason: "position_market_value_unavailable",
      };
    }

    const evidence = marks[0];
    const payload = positionQuotePayloadSchema.safeParse(evidence.payload);
    if (
      !payload.success ||
      !/^[0-9a-f]{64}$/.test(evidence.contentHashSha256) ||
      payload.data.instrumentId !== position.instrumentId ||
      payload.data.currencyCode !== position.quoteCurrencyCode ||
      parseFixedDecimal(payload.data.price).mantissa <= BigInt(0) ||
      !validPeriod(
        payload.data.validFromMs,
        payload.data.validUntilMs,
        payload.data.marketAtMs,
        input.asOfMs,
      )
    ) {
      return {
        status: "UNRESOLVED" as const,
        equityMinor: null,
        unresolvedReason: "position_market_value_unavailable",
      };
    }

    const valueMinor = marketValueMinor(
      payload.data.price,
      position.quantityShares,
      position.quoteCurrencyCode,
    );
    if (position.quoteCurrencyCode === "JPY") equityMinor += valueMinor;
    else if (fxRate) {
      equityMinor += convertMoney(
        { amountMinor: valueMinor, currency: "USD" },
        fxRate,
        "FLOOR",
      ).amountMinor;
    }
  }

  if (usdCash !== BigInt(0) && fxRate) {
    equityMinor += convertMoney(
      { amountMinor: usdCash, currency: "USD" },
      fxRate,
      "FLOOR",
    ).amountMinor;
  }

  if (
    equityMinor > maxSqliteInteger ||
    equityMinor < -maxSqliteInteger - BigInt(1)
  ) {
    return {
      status: "UNRESOLVED" as const,
      equityMinor: null,
      unresolvedReason: "equity_value_out_of_range",
    };
  }
  return {
    status: "VERIFIED" as const,
    equityMinor,
    unresolvedReason: null,
  };
}

export function verifyPaperEquitySnapshot(
  database: AppDatabase,
  valuation: typeof equityValuations.$inferSelect,
  ledgerEvents: PaperLedgerEvent[],
) {
  if (
    valuation.ruleVersion !== equityRuleVersion ||
    valuation.status !== "VERIFIED" ||
    valuation.equityMinor === null ||
    valuation.ledgerSequenceNo < BigInt(1) ||
    valuation.ledgerSequenceNo > BigInt(ledgerEvents.length)
  ) {
    return false;
  }

  const prefix = ledgerEvents.slice(0, Number(valuation.ledgerSequenceNo));
  if (valuation.asOfMs < prefix.at(-1)!.effectiveAtMs) return false;

  const referencedEvents = database.orm
    .select({
      ledgerEventId: equityValuationEvidence.ledgerEventId,
      sourceRecordId: equityValuationEvidence.sourceRecordId,
    })
    .from(equityValuationEvidence)
    .where(eq(equityValuationEvidence.valuationId, valuation.id))
    .all()
    .sort((a, b) => a.ledgerEventId.localeCompare(b.ledgerEventId));
  const expectedEvents = prefix
    .map((event) => ({
      ledgerEventId: event.id,
      sourceRecordId: event.sourceRecordId,
    }))
    .sort((a, b) => a.ledgerEventId.localeCompare(b.ledgerEventId));
  if (
    referencedEvents.length !== expectedEvents.length ||
    referencedEvents.some(
      (event, index) =>
        event.ledgerEventId !== expectedEvents[index]!.ledgerEventId ||
        event.sourceRecordId !== expectedEvents[index]!.sourceRecordId,
    )
  ) {
    return false;
  }

  const evidenceRows = database.orm
    .select()
    .from(equityValuationMarketEvidence)
    .where(eq(equityValuationMarketEvidence.valuationId, valuation.id))
    .all();
  const suppliedEvidence: EquityMarketEvidenceInput[] = [];
  const marketEvidence: MarketEvidence[] = [];
  for (const row of evidenceRows) {
    if (evidenceHash(row.content) !== row.contentHashSha256) return false;
    const source = getSourceEvidence(
      database,
      { sourceRecordId: row.sourceRecordId, content: row.content },
      ["MARKET_QUOTE"],
      valuation.asOfMs,
      true,
    );
    if (
      "reasonCode" in source ||
      source.record.contentHashSha256 !== row.contentHashSha256 ||
      source.record.occurredAtMs === null ||
      (source.record.authorityRole !== "EXCHANGE_PRIMARY" &&
        source.record.authorityRole !== "AUTHORIZED_VENDOR")
    ) {
      return false;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(row.content) as unknown;
    } catch {
      return false;
    }
    if (row.role === "POSITION_QUOTE" && row.instrumentId !== null) {
      const result = positionQuotePayloadSchema.safeParse(payload);
      if (
        !result.success ||
        result.data.instrumentId !== row.instrumentId ||
        BigInt(result.data.marketAtMs) !== source.record.occurredAtMs
      ) {
        return false;
      }
      suppliedEvidence.push({
        role: row.role,
        instrumentId: row.instrumentId,
        sourceRecordId: row.sourceRecordId,
        content: row.content,
      });
      marketEvidence.push({
        role: row.role,
        instrumentId: row.instrumentId,
        sourceRecordId: row.sourceRecordId,
        contentHashSha256: row.contentHashSha256,
        payload: result.data,
      });
    } else if (row.role === "FX_RATE" && row.instrumentId === null) {
      const result = fxPayloadSchema.safeParse(payload);
      if (
        !result.success ||
        BigInt(result.data.marketAtMs) !== source.record.occurredAtMs
      ) {
        return false;
      }
      suppliedEvidence.push({
        role: row.role,
        sourceRecordId: row.sourceRecordId,
        content: row.content,
      });
      marketEvidence.push({
        role: row.role,
        sourceRecordId: row.sourceRecordId,
        contentHashSha256: row.contentHashSha256,
        payload: result.data,
      });
    } else {
      return false;
    }
  }

  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        ledger: paperLedgerInputHash(prefix),
        market: marketInputHash(suppliedEvidence),
      }),
    )
    .digest("hex");
  if (inputHash !== valuation.inputHashSha256) return false;

  const projection = replayPaperLedger(prefix);
  const instrumentIds = [...projection.positions.keys()];
  const instrumentRows = instrumentIds.length
    ? database.orm
        .select()
        .from(instruments)
        .where(inArray(instruments.id, instrumentIds))
        .all()
    : [];
  const instrumentById = new Map(
    instrumentRows.map((instrument) => [instrument.id, instrument]),
  );
  const result = calculatePaperEquity({
    asOfMs: valuation.asOfMs,
    cashBalances: [...projection.cashBalances].map(
      ([currencyCode, balance]) => ({ currencyCode, ...balance }),
    ),
    positions: [...projection.positions].map(
      ([instrumentId, quantityShares]) => {
        const instrument = instrumentById.get(instrumentId);
        return {
          instrumentId,
          quantityShares,
          quoteCurrencyCode:
            instrument?.quoteCurrencyCode === "USD" ? "USD" : "JPY",
          classificationStatus:
            instrument?.classificationStatus === "VERIFIED"
              ? "VERIFIED"
              : "NOT_VERIFIED",
        };
      },
    ),
    marketEvidence,
  });

  return (
    result.status === "VERIFIED" &&
    valuation.equityMinor === result.equityMinor &&
    valuation.unresolvedReason === null
  );
}

export function isDrawdownLimitReached(equityMinor: bigint, peakMinor: bigint) {
  return (
    peakMinor > BigInt(0) && (peakMinor - equityMinor) * BigInt(5) >= peakMinor
  );
}

function evidenceHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function marketInputHash(evidence: EquityMarketEvidenceInput[]) {
  return evidence
    .map((item) => ({
      role: item.role,
      instrumentId: item.role === "POSITION_QUOTE" ? item.instrumentId : null,
      sourceRecordId: item.sourceRecordId,
      contentHashSha256: evidenceHash(item.content),
    }))
    .sort((a, b) =>
      `${a.role}:${a.instrumentId ?? ""}:${a.sourceRecordId}:${a.contentHashSha256}`.localeCompare(
        `${b.role}:${b.instrumentId ?? ""}:${b.sourceRecordId}:${b.contentHashSha256}`,
      ),
    );
}

export function createPaperEquitySnapshot(
  database: AppDatabase,
  asOfMs: bigint,
  suppliedEvidence: EquityMarketEvidenceInput[] = [],
) {
  return withTransaction(database, () => {
    const ledger = readPaperLedger(database);
    if (!ledger) throw new Error("paper_account_not_initialized");
    const { account, events, projection } = ledger;
    const lastEvent = events.at(-1)!;
    const createdAtMs = BigInt(Date.now());
    if (asOfMs < lastEvent.effectiveAtMs || asOfMs > createdAtMs)
      throw new Error("paper_equity_snapshot_time_invalid");

    const instrumentIds = [...projection.positions.keys()];
    const instrumentRows = instrumentIds.length
      ? database.orm
          .select()
          .from(instruments)
          .where(inArray(instruments.id, instrumentIds))
          .all()
      : [];
    const instrumentById = new Map(
      instrumentRows.map((instrument) => [instrument.id, instrument]),
    );
    const positions = [...projection.positions].map(
      ([instrumentId, quantityShares]) => {
        const instrument = instrumentById.get(instrumentId);
        return {
          instrumentId,
          quantityShares,
          quoteCurrencyCode:
            instrument?.quoteCurrencyCode === "USD" ? "USD" : "JPY",
          classificationStatus:
            instrument?.classificationStatus === "VERIFIED"
              ? "VERIFIED"
              : "NOT_VERIFIED",
        } as const;
      },
    );
    const usdCash = projection.cashBalances.get("USD");
    const needsFx =
      (usdCash?.settled ?? BigInt(0)) +
        (usdCash?.receivable ?? BigInt(0)) +
        (usdCash?.payable ?? BigInt(0)) !==
        BigInt(0) ||
      positions.some((position) => position.quoteCurrencyCode === "USD");
    const positionIds = new Set(
      positions.map(({ instrumentId }) => instrumentId),
    );
    const relevantEvidence = suppliedEvidence.filter(
      (evidence) =>
        (evidence.role === "POSITION_QUOTE" &&
          positionIds.has(evidence.instrumentId)) ||
        (evidence.role === "FX_RATE" && needsFx),
    );
    const inputHashSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          ledger: paperLedgerInputHash(events),
          market: marketInputHash(relevantEvidence),
        }),
      )
      .digest("hex");
    const existing = database.orm
      .select()
      .from(equityValuations)
      .where(
        and(
          eq(equityValuations.accountId, account.id),
          eq(equityValuations.asOfMs, asOfMs),
          eq(equityValuations.inputHashSha256, inputHashSha256),
          eq(equityValuations.ruleVersion, equityRuleVersion),
        ),
      )
      .get();
    if (existing) return existing;

    const acceptedEvidence: MarketEvidence[] = [];
    const persistedEvidence = [];
    for (const evidence of relevantEvidence) {
      const result = getSourceEvidence(
        database,
        { sourceRecordId: evidence.sourceRecordId, content: evidence.content },
        ["MARKET_QUOTE"],
        asOfMs,
        true,
      );
      if ("reasonCode" in result) continue;
      const { record } = result;
      let payload:
        | z.infer<typeof positionQuotePayloadSchema>
        | z.infer<typeof fxPayloadSchema>
        | null = null;
      try {
        const raw = JSON.parse(evidence.content) as unknown;
        payload =
          evidence.role === "POSITION_QUOTE"
            ? (positionQuotePayloadSchema.safeParse(raw).data ?? null)
            : (fxPayloadSchema.safeParse(raw).data ?? null);
        if (payload) persistedEvidence.push({ evidence, record });
      } catch {
        payload = null;
      }
      if (
        !payload ||
        (record.authorityRole !== "EXCHANGE_PRIMARY" &&
          record.authorityRole !== "AUTHORIZED_VENDOR") ||
        record.occurredAtMs === null ||
        BigInt(payload.marketAtMs) !== record.occurredAtMs
      ) {
        continue;
      }
      if (evidence.role === "POSITION_QUOTE") {
        acceptedEvidence.push({
          role: evidence.role,
          instrumentId: evidence.instrumentId,
          sourceRecordId: evidence.sourceRecordId,
          contentHashSha256: record.contentHashSha256,
          payload: payload as z.infer<typeof positionQuotePayloadSchema>,
        });
      } else {
        acceptedEvidence.push({
          role: evidence.role,
          sourceRecordId: evidence.sourceRecordId,
          contentHashSha256: record.contentHashSha256,
          payload: payload as z.infer<typeof fxPayloadSchema>,
        });
      }
    }

    const result = calculatePaperEquity({
      asOfMs,
      cashBalances: [...projection.cashBalances].map(
        ([currencyCode, balance]) => ({ currencyCode, ...balance }),
      ),
      positions,
      marketEvidence: acceptedEvidence,
    });
    const valuation = {
      id: randomUUID(),
      accountId: account.id,
      asOfMs,
      ledgerSequenceNo: projection.sequenceNo,
      inputHashSha256,
      status: result.status,
      equityMinor: result.equityMinor,
      currencyCode: "JPY",
      currencyScale: 0,
      unresolvedReason: result.unresolvedReason,
      ruleVersion: equityRuleVersion,
      createdAtMs,
    } as const;
    database.orm.insert(equityValuations).values(valuation).run();
    database.orm
      .insert(equityValuationEvidence)
      .values(
        events.map((event) => ({
          id: randomUUID(),
          valuationId: valuation.id,
          ledgerEventId: event.id,
          sourceRecordId: event.sourceRecordId,
        })),
      )
      .run();
    const persisted = persistedEvidence.flatMap(({ evidence, record }) => {
      const instrumentId =
        evidence.role === "POSITION_QUOTE" ? evidence.instrumentId : null;
      if (instrumentId && !instrumentById.has(instrumentId)) return [];
      return [
        {
          id: randomUUID(),
          valuationId: valuation.id,
          role: evidence.role,
          instrumentId,
          sourceRecordId: record.id,
          contentHashSha256: record.contentHashSha256,
          content: evidence.content,
        },
      ];
    });
    if (persisted.length) {
      database.orm
        .insert(equityValuationMarketEvidence)
        .values(persisted)
        .run();
    }
    return valuation;
  });
}
