import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db";
import {
  marketPriceBars,
  paperAccounts,
  sourceRecords,
  sources,
} from "@/db/schema";
import { listMarketEvents } from "@/features/evidence/repository";
import { runCodexTask } from "@/features/ai/codex-adapter";
import {
  researchModelOutputSchema,
  researchReportSchema,
  type ResearchReport,
  type ResearchReportType,
} from "@/features/reports/contract";

const timeZone = "Asia/Tokyo";
const roleKeys = [
  "coordinator",
  "intelligence",
  "marketStructure",
  "strategyResearch",
  "riskOfficer",
  "paperPlanner",
] as const;

type EvidenceReference = {
  id: string;
  canonicalUrl: string | null;
  publishedAtMs: number | null;
  occurredAtMs: number | null;
  availableAtMs: number | null;
  collectedAtMs: number;
  dataClass: "REAL" | "DELAYED" | "HISTORICAL" | "FIXTURE" | "NOT_VERIFIED";
  publisher: string;
  referenceUrl: string | null;
  authorityRole: string;
  licenseStatus: string;
  marketCode: "US" | "JP" | null;
  text: string[];
};

type StoredBar = {
  marketCode: "US" | "JP";
  symbol: string;
  tradingDate: string;
  openMantissa: bigint;
  highMantissa: bigint;
  lowMantissa: bigint;
  closeMantissa: bigint;
  priceScale: number;
  volumeShares: bigint;
  sourceRecordId: string;
  collectedAtMs: number;
  dataClass: EvidenceReference["dataClass"];
  publisher: string;
  referenceUrl: string | null;
  canonicalUrl: string | null;
  publishedAtMs: number | null;
  occurredAtMs: number | null;
  availableAtMs: number | null;
  authorityRole: string;
  licenseStatus: string;
};

const reportTitles: Record<ResearchReportType, string> = {
  MORNING: "美日量化研究晨报",
  ANOMALY: "美日市场异常报告",
  DAILY_AUDIT: "美日策略与纸面模拟日度审计",
  WEEKLY_AUDIT: "美日策略与纸面模拟周度审计",
};

function toSafeNumber(value: bigint | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function price(mantissa: bigint, scale: number) {
  const digits = mantissa.toString().padStart(scale + 1, "0");
  return scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function extractDateMs(value: string, marketCode: "US" | "JP") {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.getTime() + (marketCode === "JP" ? 6.5 : 21) * 60 * 60 * 1_000
    : null;
}

function collectEvidence(database: AppDatabase, nowMs: number) {
  const references = new Map<string, EvidenceReference>();
  const events = listMarketEvents(database)
    .map((event) => {
      const revision = event.revisions.at(-1);
      return revision ? { eventId: event.id, revision } : null;
    })
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .sort((left, right) =>
      Number(right.revision.recordedAtMs - left.revision.recordedAtMs),
    )
    .slice(0, 20);

  for (const { revision } of events) {
    for (const evidence of revision.evidence) {
      const existing = references.get(evidence.sourceRecordId);
      const text = `${revision.category}: ${revision.summary}; ${revision.importanceReason}`;
      if (existing) {
        existing.text.push(text);
        continue;
      }
      references.set(evidence.sourceRecordId, {
        id: evidence.sourceRecordId,
        canonicalUrl: evidence.canonicalUrl,
        publishedAtMs: toSafeNumber(evidence.publishedAtMs),
        occurredAtMs: toSafeNumber(evidence.occurredAtMs),
        availableAtMs: toSafeNumber(evidence.availableAtMs),
        collectedAtMs: Number(evidence.collectedAtMs),
        dataClass: evidence.dataClass as EvidenceReference["dataClass"],
        publisher: evidence.publisher,
        referenceUrl: evidence.sourceReferenceUrl,
        authorityRole: evidence.authorityRole,
        licenseStatus: evidence.sourceLicenseStatus,
        marketCode:
          revision.marketCode === "US" || revision.marketCode === "JP"
            ? revision.marketCode
            : null,
        text: [text],
      });
    }
  }

  const rows = database.orm
    .select({
      marketCode: marketPriceBars.marketCode,
      symbol: marketPriceBars.symbol,
      tradingDate: marketPriceBars.tradingDate,
      openMantissa: marketPriceBars.openMantissa,
      highMantissa: marketPriceBars.highMantissa,
      lowMantissa: marketPriceBars.lowMantissa,
      closeMantissa: marketPriceBars.closeMantissa,
      priceScale: marketPriceBars.priceScale,
      volumeShares: marketPriceBars.volumeShares,
      sourceRecordId: sourceRecords.id,
      collectedAtMs: marketPriceBars.collectedAtMs,
      dataClass: sourceRecords.dataClass,
      publisher: sources.publisher,
      referenceUrl: sources.referenceUrl,
      canonicalUrl: sourceRecords.canonicalUrl,
      publishedAtMs: sourceRecords.publishedAtMs,
      occurredAtMs: sourceRecords.occurredAtMs,
      availableAtMs: sourceRecords.availableAtMs,
      authorityRole: sources.authorityRole,
      licenseStatus: sources.licenseStatus,
    })
    .from(marketPriceBars)
    .innerJoin(
      sourceRecords,
      eq(marketPriceBars.sourceRecordId, sourceRecords.id),
    )
    .innerJoin(sources, eq(sourceRecords.sourceId, sources.id))
    .orderBy(
      desc(marketPriceBars.tradingDate),
      desc(marketPriceBars.collectedAtMs),
    )
    .limit(1_000)
    .all()
    .map(
      (row) =>
        ({
          ...row,
          marketCode: row.marketCode as "US" | "JP",
          collectedAtMs: Number(row.collectedAtMs),
          publishedAtMs: toSafeNumber(row.publishedAtMs),
          occurredAtMs: toSafeNumber(row.occurredAtMs),
          availableAtMs: toSafeNumber(row.availableAtMs),
          dataClass: row.dataClass as EvidenceReference["dataClass"],
        }) satisfies StoredBar,
    );

  for (const bar of rows) {
    const text = `${bar.marketCode} ${bar.symbol} ${bar.tradingDate} ${bar.publisher} ${bar.dataClass} ${bar.licenseStatus} ${bar.authorityRole} open=${price(bar.openMantissa, bar.priceScale)} high=${price(bar.highMantissa, bar.priceScale)} low=${price(bar.lowMantissa, bar.priceScale)} close=${price(bar.closeMantissa, bar.priceScale)} volume=${bar.volumeShares.toString()}`;
    const existing = references.get(bar.sourceRecordId);
    if (existing) {
      existing.text.push(text);
      continue;
    }
    references.set(bar.sourceRecordId, {
      id: bar.sourceRecordId,
      canonicalUrl: bar.canonicalUrl,
      publishedAtMs: bar.publishedAtMs,
      occurredAtMs: bar.occurredAtMs,
      availableAtMs: bar.availableAtMs,
      collectedAtMs: bar.collectedAtMs,
      dataClass: bar.dataClass,
      publisher: bar.publisher,
      referenceUrl: bar.referenceUrl,
      authorityRole: bar.authorityRole,
      licenseStatus: bar.licenseStatus,
      marketCode: bar.marketCode,
      text: [text],
    });
  }

  const eventSummaries = events.map(({ eventId, revision }) => ({
    eventId,
    category: revision.category,
    summary: revision.summary,
    marketCode: revision.marketCode,
    occurredAtMs: toSafeNumber(revision.occurredAtMs),
    publishedAtMs: toSafeNumber(revision.publishedAtMs),
    dataClass: revision.dataClass,
    verificationLevel: revision.verificationLevel,
    evidenceIds: revision.evidence.map((evidence) => evidence.sourceRecordId),
  }));

  return { references, events: eventSummaries, bars: rows, nowMs };
}

function qualifiedPriceInstruments(
  bars: StoredBar[],
  marketCode: "US" | "JP",
  nowMs: number,
) {
  const qualified = bars.filter(
    (bar) =>
      bar.marketCode === marketCode &&
      (bar.dataClass === "REAL" || bar.dataClass === "DELAYED") &&
      (bar.authorityRole === "AUTHORIZED_VENDOR" ||
        bar.authorityRole === "EXCHANGE_PRIMARY") &&
      bar.licenseStatus === "VERIFIED" &&
      bar.collectedAtMs <= nowMs &&
      nowMs - bar.collectedAtMs <= 7 * 24 * 60 * 60 * 1_000,
  );
  const bySymbol = new Map<string, StoredBar[]>();
  for (const bar of qualified) {
    const rows = bySymbol.get(bar.symbol) ?? [];
    rows.push(bar);
    bySymbol.set(bar.symbol, rows);
  }
  return new Map(
    [...bySymbol].flatMap(([symbol, rows]) => {
      const latestBarAtMs = extractDateMs(rows[0].tradingDate, marketCode);
      const ageMs = latestBarAtMs === null ? null : nowMs - latestBarAtMs;
      const dates = new Set(rows.map((bar) => bar.tradingDate));
      if (
        dates.size < 30 ||
        ageMs === null ||
        ageMs < 0 ||
        ageMs > 7 * 24 * 60 * 60 * 1_000
      ) {
        return [];
      }
      return [
        [
          `${marketCode}:${symbol}`,
          new Set(rows.map((bar) => bar.sourceRecordId)),
        ],
      ];
    }),
  );
}

function sourceCoverage(
  references: Map<string, EvidenceReference>,
  nowMs: number,
) {
  return [...references.values()].map((reference) => {
    const ageMs = nowMs - reference.collectedAtMs;
    const status =
      reference.dataClass === "REAL"
        ? ageMs <= 24 * 60 * 60 * 1_000
          ? "AVAILABLE"
          : "STALE"
        : reference.dataClass === "DELAYED"
          ? "DELAYED"
          : reference.dataClass === "HISTORICAL"
            ? "STALE"
            : "UNKNOWN";
    return {
      id: reference.id,
      name: reference.publisher,
      url: reference.canonicalUrl ?? reference.referenceUrl,
      status,
      dataClass: reference.dataClass,
      marketAtMs: reference.occurredAtMs ?? reference.publishedAtMs,
      marketTimeZone: null,
      collectedAtMs: reference.collectedAtMs,
      collectedTimeZone: "UTC",
      currency:
        reference.marketCode === "JP"
          ? "JPY"
          : reference.marketCode === "US"
            ? "USD"
            : null,
      delayStatement:
        reference.dataClass === "DELAYED"
          ? "来源记录标记为延迟；具体延迟时长未核实。"
          : null,
      limitation:
        "来源记录仅保存元数据与内容哈希；公司披露只使用已归一化摘要，未读取原始正文。",
      evidenceIds: [reference.id],
    };
  });
}

function marketSummary(
  bars: StoredBar[],
  eventCount: number,
  references: Map<string, EvidenceReference>,
  ledgerState: ResearchReport["ledgerState"],
) {
  const latestFor = (marketCode: "US" | "JP") =>
    bars.find((bar) => bar.marketCode === marketCode);
  const latestUs = latestFor("US");
  const latestJp = latestFor("JP");
  const eventIds = [...references.values()]
    .filter((reference) => reference.marketCode !== null)
    .map((reference) => reference.id)
    .slice(0, 10);
  return [
    {
      text: latestUs
        ? `美股本机保存的行情记录截至 ${latestUs.tradingDate}；不代表已核实的最新完成交易日。`
        : "美股本机没有已保存的价格记录；无法确认最新完成交易日。",
      evidenceIds: latestUs ? [latestUs.sourceRecordId] : [],
    },
    {
      text: latestJp
        ? `日股本机保存的行情记录截至 ${latestJp.tradingDate}；不代表已核实的最新完成交易日。`
        : "日股本机没有已保存的价格记录；无法确认最新完成交易日。",
      evidenceIds: latestJp ? [latestJp.sourceRecordId] : [],
    },
    {
      text:
        eventCount > 0
          ? `本机保存 ${eventCount} 条事件记录；覆盖不完整，不能据此断言没有新公告。`
          : "本机没有已保存的事件证据；这不代表没有新公告。",
      evidenceIds: eventIds,
    },
    {
      text: "汇率、利率、宏观日历与官方交易日历尚无可核实的本地快照。",
      evidenceIds: [],
    },
    {
      text:
        ledgerState === "INITIALIZED"
          ? "本机纸面账户已初始化；本报告没有行情重估权益或核验收益。"
          : "未建立共享交易账本；没有可核实持仓、成交、权益或累计收益。",
      evidenceIds: [],
    },
  ];
}

function emptyRoleAudit(status: ResearchReport["executionStatus"]) {
  const role = { status, summary: null, evidenceIds: [] };
  return {
    coordinator: role,
    intelligence: role,
    marketStructure: role,
    strategyResearch: role,
    riskOfficer: role,
    paperPlanner: role,
  } satisfies ResearchReport["roleAudit"];
}

function baseReport(input: {
  taskRunId: string;
  type: ResearchReportType;
  generatedAtMs: number;
  executionStatus: ResearchReport["executionStatus"];
  resultCode: string;
  marketDataReady: boolean;
  eventCount: number;
  bars: StoredBar[];
  references: Map<string, EvidenceReference>;
  ledgerState: ResearchReport["ledgerState"];
  ledgerSummary: string | null;
}) {
  const dataClass = [...input.references.values()].some(
    (reference) => reference.dataClass === "FIXTURE",
  )
    ? "FIXTURE"
    : input.references.size === 0
      ? "NOT_VERIFIED"
      : [...input.references.values()].every(
            (reference) => reference.dataClass === "HISTORICAL",
          )
        ? "HISTORICAL"
        : [...input.references.values()].some(
              (reference) => reference.dataClass === "NOT_VERIFIED",
            )
          ? "NOT_VERIFIED"
          : [...input.references.values()].some(
                (reference) => reference.dataClass === "DELAYED",
              )
            ? "DELAYED"
            : "REAL";
  const limitations = [
    "报告只使用本机已保存证据，不在报告任务中执行行情或新闻的外部采集。",
    "本地价格记录覆盖、官方交易日历及 FX/利率快照未核实。",
    "不进行回测、收益评分、纸面成交或真实交易；策略候选必须引用有效证据。",
  ];
  if (!input.marketDataReady) {
    limitations.push(
      "美股和日股均未达到可提出策略候选的行情证据门槛；候选列表强制为空。",
    );
  }
  if (input.references.size === 0) {
    limitations.push(
      "当前没有可供 Codex 分析的已保存来源；未调用模型，六个角色状态为 SKIPPED。",
    );
  }
  if (input.ledgerSummary) limitations.push(input.ledgerSummary);

  return researchReportSchema.parse({
    id: input.taskRunId,
    type: input.type,
    title: reportTitles[input.type],
    generatedAtMs: input.generatedAtMs,
    asOfMs: input.generatedAtMs,
    timeZone,
    executionStatus: input.executionStatus,
    verificationLevel: dataClass === "FIXTURE" ? "DEMO_ONLY" : "NOT_VERIFIED",
    dataClass,
    resultCode: input.resultCode,
    marketSummary: marketSummary(
      input.bars,
      input.eventCount,
      input.references,
      input.ledgerState,
    ),
    facts: [],
    inferences: [],
    hypotheses: [],
    candidates: [],
    roleAudit: emptyRoleAudit(
      input.executionStatus === "DONE" ? "SKIPPED" : input.executionStatus,
    ),
    riskVerdict: {
      status: "UNRESOLVED",
      reasons: [
        "本地证据不足以执行确定性研究和交易风险检查；模型意见不能替代 2% 单笔风险与 20% 回撤门禁。",
      ],
    },
    riskOfficerReview: null,
    ledgerState: input.ledgerState,
    ledgerSummary: input.ledgerSummary,
    sourceCoverage: sourceCoverage(input.references, input.generatedAtMs),
    limitations,
    finalDecision: input.marketDataReady
      ? "仅供研究观察；未核验前不得进入纸面模拟。"
      : "继续观察；数据不足，不提出策略候选或纸面交易计划。",
  });
}

function reportPrompt(
  type: ResearchReportType,
  input: ReturnType<typeof collectEvidence>,
  marketDataReady: boolean,
) {
  const bars = input.bars.map((bar) => ({
    market: bar.marketCode,
    symbol: bar.symbol,
    tradingDate: bar.tradingDate,
    open: price(bar.openMantissa, bar.priceScale),
    high: price(bar.highMantissa, bar.priceScale),
    low: price(bar.lowMantissa, bar.priceScale),
    close: price(bar.closeMantissa, bar.priceScale),
    volume: bar.volumeShares.toString(),
    sourceRecordId: bar.sourceRecordId,
    dataClass: bar.dataClass,
    collectedAtMs: bar.collectedAtMs,
  }));
  const eventEvidence = input.events.map((event) => ({
    ...event,
    evidenceIds: event.evidenceIds,
  }));
  const references = [...input.references.values()].map((reference) => ({
    id: reference.id,
    publisher: reference.publisher,
    url: reference.canonicalUrl ?? reference.referenceUrl,
    dataClass: reference.dataClass,
    authorityRole: reference.authorityRole,
    licenseStatus: reference.licenseStatus,
    collectedAtMs: reference.collectedAtMs,
    publishedAtMs: reference.publishedAtMs,
    occurredAtMs: reference.occurredAtMs,
    contentAvailable: false,
    summaries: reference.text,
  }));

  return [
    `Generate a ${type} research report for US and Japan equities and non-leveraged ETFs. Report timezone: ${timeZone}.`,
    "You are one local Codex call performing six roles in sequence: coordinator, intelligence, market structure, strategy research, independent risk officer, paper planner. These are role labels in one model response, not independent agents.",
    "Only use the persisted records below. Do not use web search, TradingView, unseen files, memory, assumed live quotes, or facts absent from these records. Source records contain metadata, hashes and normalized summaries only; raw disclosure bodies are unavailable.",
    "Every fact, inference, hypothesis and candidate must cite only the supplied sourceRecordId values. Do not invent dates, prices, trading sessions, news, returns, backtests, scores, trades, account balances, FX or interest rates.",
    "Set paperPlanner to SKIPPED. The deterministic paper ledger and risk engines are not available to this report workflow. riskOfficer may return VETO or NO_VETO, but NO_VETO is not approval.",
    marketDataReady
      ? "At least 30 recent, licensed price observations exist for both markets. Candidate strategies remain unverified research hypotheses; do not claim performance, validation or paper execution."
      : "Market data is missing, unverified, stale, incomplete or below the minimum coverage. Return zero candidates and do not infer no new events. Mark affected role outputs as SKIPPED when they lack evidence.",
    `Persisted event summaries: ${JSON.stringify(eventEvidence)}`,
    `Persisted price bars: ${JSON.stringify(bars)}`,
    `Source records: ${JSON.stringify(references)}`,
  ].join("\n\n");
}

export async function runResearchReportWorkflow(input: {
  database: AppDatabase;
  taskRunId: string;
  type: ResearchReportType;
  signal: AbortSignal;
  nowMs?: number;
}) {
  const generatedAtMs = input.nowMs ?? Date.now();
  const evidence = collectEvidence(input.database, generatedAtMs);
  const qualifiedInstruments = new Map([
    ...qualifiedPriceInstruments(evidence.bars, "US", generatedAtMs),
    ...qualifiedPriceInstruments(evidence.bars, "JP", generatedAtMs),
  ]);
  const marketDataReady = ["US", "JP"].every((marketCode) =>
    [...qualifiedInstruments.keys()].some((key) =>
      key.startsWith(`${marketCode}:`),
    ),
  );
  const account = input.database.orm
    .select({ id: paperAccounts.id })
    .from(paperAccounts)
    .where(eq(paperAccounts.accountKey, "local-default"))
    .get();
  const ledgerState = account ? "INITIALIZED" : "NOT_INITIALIZED";
  const ledgerSummary = account
    ? "已找到本机纸面账户记录；未核验账户余额、持仓、权益或历史成交。"
    : "未建立共享交易账本；没有可核实持仓、成交、权益或累计收益。";
  const base = baseReport({
    taskRunId: input.taskRunId,
    type: input.type,
    generatedAtMs,
    executionStatus: "DONE",
    resultCode:
      evidence.references.size === 0 ? "NO_SAVED_EVIDENCE" : "NOT_VERIFIED",
    marketDataReady,
    eventCount: evidence.events.length,
    bars: evidence.bars,
    references: evidence.references,
    ledgerState,
    ledgerSummary,
  });

  if (input.signal.aborted || evidence.references.size === 0) return base;

  const schema = z.toJSONSchema(researchModelOutputSchema);
  delete schema.$schema;
  const result = await runCodexTask(input.database, {
    prompt: reportPrompt(input.type, evidence, marketDataReady),
    sourceRecordIds: [...evidence.references.keys()],
    outputSchema: schema,
    signal: input.signal,
  });
  if (result.status !== "DONE") {
    return researchReportSchema.parse({
      ...base,
      executionStatus: result.status,
      resultCode:
        result.status === "BLOCKED_EXTERNAL"
          ? result.errorCode
          : result.errorCode,
      roleAudit: emptyRoleAudit(result.status),
      limitations: [
        ...base.limitations,
        `Codex 研究调用未完成：${result.errorCode}。`,
      ],
      finalDecision: "研究调用未完成；报告保持未核验，不生成候选。",
    });
  }

  let output: unknown;
  try {
    output = JSON.parse(result.output);
  } catch {
    output = null;
  }
  const parsed = researchModelOutputSchema.safeParse(output);
  if (!parsed.success) {
    return researchReportSchema.parse({
      ...base,
      executionStatus: "FAILED",
      resultCode: "AI_OUTPUT_INVALID",
      limitations: [...base.limitations, "Codex 输出不符合结构化报告契约。"],
      finalDecision: "报告结构校验失败；不采纳模型输出。",
    });
  }

  const model = parsed.data;
  const allowedIds = new Set(evidence.references.keys());
  const keepSupported = <T extends { evidenceIds: string[] }>(items: T[]) =>
    items.filter((item) => item.evidenceIds.every((id) => allowedIds.has(id)));
  const roleAudit = Object.fromEntries(
    roleKeys.map((key) => {
      const role = model.roleAudit[key];
      const valid = role.evidenceIds.every((id) => allowedIds.has(id));
      return [
        key,
        {
          status: valid ? role.status : "SKIPPED",
          summary: valid ? role.summary : "引用证据不可用，角色输出未采纳。",
          evidenceIds: valid ? role.evidenceIds : [],
        },
      ];
    }),
  ) as ResearchReport["roleAudit"];
  const riskOfficerReview = model.riskOfficerReview.evidenceIds.every((id) =>
    allowedIds.has(id),
  )
    ? model.riskOfficerReview
    : {
        opinion: "VETO" as const,
        summary: "风险意见引用了未提供的证据；按失败关闭处理。",
        evidenceIds: [],
      };
  const candidates =
    marketDataReady &&
    riskOfficerReview.opinion !== "VETO" &&
    roleAudit.strategyResearch.status === "DONE"
      ? keepSupported(model.candidates)
          .filter((candidate) =>
            qualifiedInstruments.has(
              `${candidate.marketCode}:${candidate.symbol}`,
            ),
          )
          .map((candidate, index) => ({
            ...candidate,
            id: `${input.taskRunId}:candidate-${index + 1}`,
          }))
      : [];
  const hasUnsupportedOutput =
    keepSupported(model.facts).length !== model.facts.length ||
    keepSupported(model.inferences).length !== model.inferences.length ||
    keepSupported(model.hypotheses).length !== model.hypotheses.length ||
    keepSupported(model.candidates).length !== model.candidates.length ||
    roleKeys.some(
      (key) =>
        !model.roleAudit[key].evidenceIds.every((id) => allowedIds.has(id)),
    );
  const acceptedFacts = keepSupported(model.facts);
  const acceptedInferences = keepSupported(model.inferences);
  const acceptedHypotheses = keepSupported(model.hypotheses);
  const paperPlanner = {
    status: "SKIPPED" as const,
    summary: "确定性账户与纸面交易门禁未接入，本角色不生成模拟计划。",
    evidenceIds: [],
  };
  roleAudit.paperPlanner = paperPlanner;

  return researchReportSchema.parse({
    ...base,
    resultCode: marketDataReady
      ? "RESEARCH_NOT_VERIFIED"
      : "NO_QUALIFIED_MARKET_DATA",
    facts: acceptedFacts,
    inferences: acceptedInferences,
    hypotheses: acceptedHypotheses,
    candidates,
    roleAudit,
    riskVerdict: {
      status: riskOfficerReview.opinion === "VETO" ? "REJECTED" : "UNRESOLVED",
      reasons:
        riskOfficerReview.opinion === "VETO"
          ? [riskOfficerReview.summary]
          : ["模型未提出否决不代表风控通过；确定性交易风险和行情门禁未执行。"],
    },
    riskOfficerReview,
    limitations: hasUnsupportedOutput
      ? [
          ...base.limitations,
          "部分模型输出引用未知或无效证据，已丢弃并保持 NOT_VERIFIED。",
        ]
      : base.limitations,
    finalDecision: roleKeys.some((key) => roleAudit[key].status !== "DONE")
      ? "研究流程不完整；缺失角色步骤已标注，继续观察且不产生纸面交易计划。"
      : candidates.length > 0
        ? "仅保留有证据引用的未验证研究假设；不得视为模拟交易许可。"
        : marketDataReady
          ? "继续观察；没有通过证据与风控门禁的策略候选。"
          : "继续观察；市场行情证据不足，策略候选列表为空。",
  });
}
