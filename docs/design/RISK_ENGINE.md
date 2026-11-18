# 风控引擎与订单仓位计算

> 状态：P03-03 风险规则已由 P10-02/P10-03 接入运行时。计划版本、证据 hash、确定性裁决和本机批准由 [`checker.ts`](../../src/features/risk/checker.ts) 执行；[`drawdown.ts`](../../src/features/risk/drawdown.ts) 按可信报价和 USD/JPY 证据估值，并在峰值回撤达到 20% 时阻止新头寸。报价或汇率缺失、失效、冲突或无法验证时权益保持 `UNRESOLVED`。P10-04 已接入本地模拟买单和成交引擎；没有合格实时行情时仍不能创建真实来源成交。卖出/止损退出撮合及完整恢复审计仍未实现。本文件落实 [FR-Trade](../requirements/FR_TRADE.md) 的固定规则，不新增或放宽风险阈值。
>
> 相关设计：[DB Schema](DB_SCHEMA.md)、[API/DTO 契约](API_CONTRACTS.md)、[数据溯源](DATA_PROVENANCE.md)。

## 决策边界

- V1 仅允许已分类的美日上市普通股票及非杠杆 ETF 做多；不支持保证金、借款、卖空或期权。
- 已初始化账户的单笔计划风险上限固定为当期可核验权益的 **2%**。权益相对有效历史峰值回撤达到 **20%**（含等号）时拒绝所有新增头寸。阈值不是策略参数、模型输出或用户设置。
- 风控裁决只有 `PASS`、`REJECT`、`UNRESOLVED`。`PASS` 仅表示本次不可变计划版本通过已定义门槛，不等于使用者批准、订单创建或成交。
- 裁决状态与数据类别/验证级别分开保存。Fixture 计算只可显示为隔离的 `DEMO_ONLY` 结果；不能成为可批准的运行时 `PASS` 或写入纸面账本。
- 风控只生成裁决和允许数量上限，不更改原计划数量。请求数量超过上限时拒绝；调整数量必须建立新版本并重新评估。
- 本任务定义单笔风险、现金购买力和集中度报告，不擅自增加组合总风险、单证券、行业或币种的固定仓位百分比上限。FR-Trade 明确没有依据时不得臆造组合上限。

## 可核验权益与现金

账户仅在显式初始化时写入固定的 `1,000,000 JPY` 起始资金事件。初始化前没有可供风控使用的余额、权益峰值或持仓。

时点 `t` 的账户权益以 JPY 表示：

```text
equityJPY(t) = Σc [settledCash(c) + unsettledReceivables(c) - unsettledPayables(c)]
                     × FXJPYper(c, t)
             + Σi [positionQty(i) × verifiedMark(i, t)
                   × FXJPYper(quoteCurrency(i), t)]
             - accruedLiabilitiesJPY(t)
```

- `FXJPYper(c, t)` 表示每 1 单位币种 `c` 可折算的 JPY；JPY 的汇率固定为 1。USD/JPY 必须使用方向明确、时点有效的观测，不猜测倒数、不把 USD 当 JPY。
- 持仓估值使用 `EXCHANGE_PRIMARY` 或 `AUTHORIZED_VENDOR` 来源的报价，并核对来源许可、内容 hash、来源时间、报价币种及有效期。估值快照保存所用报价/FX 原文、来源记录与 hash；价格乘数量和 FX 换算均向下舍入到 JPY 最小单位。
- 不允许在报价或 FX 失效、缺失、冲突、被替代或无法核验时静默退回旧价、收盘价或零。任何必需输入不可用，整体权益即为 `UNRESOLVED`。
- 任何持仓报价、所需 FX、成本负债或账本投影无法核验时，整体权益为 `UNRESOLVED`。不能剔除缺价或不利持仓后继续批准。
- 未结算卖出款可以进入权益的应收项，但不是可买现金。可用现金按币种计算，扣除尚未由现金流水结清的买单预留、买入应付款和费用；各项在生命周期中只能扣减一次。未成交订单预留不重复降低账户权益。
- USD 购买力必须来自已有已结算 USD 现金，或先完成可审计的模拟 FX 转换并记账。JPY 现金不足以隐式生成 USD 购买力。
- 所有金额、价格、数量、FX 与舍入使用整数最小单位加 scale 或精确十进制语义；禁止 JS `number` 金融运算。[DOC-0038](DOMAIN_PRIMITIVES.md) 定义共同定点、币种和舍入原语；输入快照、来源、规则版本和计算结果随风控裁决保存，以便重算。

## 峰值权益与回撤门禁

```text
peakEquityJPY(t) = max(1,000,000, verifiedEquityJPY(s))
                   for initializationTime <= s <= t
drawdown(t) = max(0, (peakEquityJPY(t) - verifiedEquityJPY(t))
                     / peakEquityJPY(t))
```

- 初始峰值来自 `ACCOUNT_OPENED` 的配置本金。峰值取初始本金与当前时点之前所有 `VERIFIED` 权益快照的最大值；只有完整、可核验的权益快照可更新峰值。缺数据、过期数据、冲突数据或 Fixture 不能降低、重置或抬高峰值。
- 峰值或当前权益不可核验时返回 `UNRESOLVED` 并禁止新增头寸。已知当前权益 `<= 0` 时返回 `REJECT`；不以 0 权益计算一个可用预算。
- `drawdown >= 0.20` 时返回 `REJECT`，精确等于 20% 也阻断新增头寸。低于 20% 只表示回撤门禁未触发，仍须通过全部其他条件。
- 达到门槛不强制平仓；减少风险的计划不因该门禁而被禁止，但模拟成交仍须独立满足有效价格和成交规则。

## 单笔风险与价格假设

风险模型/成本模型必须给出具版本、适用市场与有效期的入场滑点、止损滑点、跳空预算、价格 tick、佣金、交易所/监管费用、适用税费和 FX 转换成本。它们不能由策略、AI 或单次计划降低；无有效规则或必要费用未知时返回 `UNRESOLVED`，不得按零成本通过。具体数值由之后经核验的市场/成本政策提供，本设计不臆造市场费率或跳空百分比。

对只做多计划，输入的入场价格必须为正，止损价必须低于入场价。按对应证券的有效 tick 向不利方向取整后：

```text
entrySlipPrice = ceilToTick(entryReference × entrySlippageBps / 10,000)
stopSlipPrice  = ceilToTick(stopReference × stopSlippageBps / 10,000)
gapReserve     = ceilToTick(stopReference × gapReserveBps / 10,000)

assumedEntryFill = ceilToTick(entryReference + entrySlipPrice)
assumedStopFill  = max(0, floorToTick(stopReference
                                      - stopSlipPrice
                                      - gapReserve))
```

所有 `Bps` 值来自固定版本的风险/成本规则，不接收模型输出或单次策略覆写。策略不得省略止损或通过缩小预算字段扩大仓位。跳空预算是有版本的情景假设，不是损失保证；实际成交可能更差。止损触发价不保证成交价，见 [SEC Investor.gov 的止损订单说明](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-15)。

计划价格、FX 和 tick 必须为正且单位匹配；止损价允许为 0，但必须低于入场价。滑点、跳空缓冲和 FX 冲击 bps 不得为负。策略输入违反条件时 `REJECT`；固定规则版本本身无效、费率/缓冲范围不合法或有效 tick 无法确定时 `UNRESOLVED`。

对允许的计划股数 `q`，各币种风险额及 JPY 计划损失为：

```text
priceRisk(c, q) = q × max(0, assumedEntryFill(c) - assumedStopFill(c))

plannedLossJPY(q) = ceilJPY(Σc [priceRisk(c, q)
                                 + entryFees(c, q)
                                 + exitFees(c, q)
                                 + otherApplicableCosts(c, q)]
                                 × conservativeFXJPYper(c, t)
                             + FXConversionCostsJPY(q))

riskBudgetJPY = floorJPY(verifiedEquityJPY(t) × 0.02)
```

- `conservativeFXJPYper(c, t)` 由有效 FX 观测和具版本、可追溯的 FX 风险缓冲规则得出；JPY 为 1。外币损失按不利的高 JPY/外币折算。缺少 FX 观测或适用的缓冲规则时，不得假定零 FX 风险。
- 对外币正数损失，保守汇率按 `ceilRate(FXJPYperObserved(c, t) × (1 + fxShockBps(c) / 10,000))` 计算；`fxShockBps` 来自具证据的版本化规则，不由策略或 AI 设定。`ceilRate` 向上取整到受支持的 FX 精度。实际权益估值使用时点有效的观测汇率，不叠加风险缓冲。
- 每个费用按实际币种和完整数量计算后再按规则换算，固定最低佣金等阶梯费用不得简单按股数线性外推。所有风险成本向上舍入到 JPY 最小单位，预算向下舍入。
- 风险单位是一个有效交易单位在同一计划/规则快照下的 `plannedLossJPY`。正式上限始终针对完整计划数量及全部成本计算，不能通过先舍入单股风险再乘算而放宽 2% 门槛。

## 数量、现金与透支

允许数量 `q` 必须是证券交易单位 `lotSize` 的正整数倍。V1 美股按整股；日本普通股票按 100 股；日本 ETF 读取该证券的已核验交易单位。未知单位不能默认。

```text
buyCommitment(c, q) = ceilCurrency(q × assumedEntryFill(c)
                                     + entryFees(c, q)
                                     + acquisitionCosts(c, q))

qMax = max { q | q > 0, q mod lotSize = 0,
                 plannedLossJPY(q) <= riskBudgetJPY,
                 for every required currency c:
                   buyCommitment(c, q) <= availableSettledCash(c) }
```

- 对策略/计划提交的 `requestedQuantity`，仅在其为交易单位倍数且不超过 `qMax` 时允许风险 `PASS`。超风险预算、资金不足或至少一手都无法满足时返回 `REJECT` 和 `maxAllowedQuantity`（可为 0）；不得静默截短、借款或透支。
- `availableSettledCash(c)` 只使用该币种已结算现金，并扣除其他有效买单预留、未结清买入应付款及费用。未结算卖出应收款不增加购买力。JPY 和 USD 分别检查，不跨币种挪用。
- `buyCommitment` 超过现金时，即使计划损失低于 2% 也必须拒绝。例如初始现金 1,000,000 JPY、日股 100 股一手、入场 12,000 JPY，即使止损距离仅 100 JPY，单手买入本金已是 1,200,000 JPY，仍因资金不足拒绝。
- 没有有效报价、交易单位、成本模型或必需 FX 时不能计算可信的 `qMax`，结果是 `UNRESOLVED`，不能把未知数量写为 0 风险后放行。

## P10-04 模拟入场成交

模拟买单必须绑定同一计划版本的当前最新 `PASS` 裁决和本地批准，并按该版本计算的买入承诺预留已结算现金。撤单只释放未成交预留，不回写或冲掉已有成交。未成交订单的预留按币种分别从可用现金扣除。

只有许可和来源角色已核验、未被 supersede、数据类别为 `REAL` 的 `MARKET_QUOTE` 可产生正式成交。报价 JSON 中的证券、币种、价格、成交量、`marketAtMs` 和有效区间必须通过 schema；`marketAtMs` 必须与 source record 的市场时刻相同，且位于报价有效期。撮合时间必须处于已支持交易日历的开市 session。Fixture 返回 `DEMO_ONLY` 拒绝结果，历史/延迟/过期/错时/闭市输入为 `NOT_VERIFIED`，均不写 fill 或现金/持仓/费用流水。

当前 P10-04 撮合只处理获批多头计划的买入入场。参与成交量与价格按以下固定规则计算：

```text
eligibleVolume = floor(quote.volumeShares × maxParticipationBps / 10,000)
volumeShares = floor(eligibleVolume / tradingUnit) × tradingUnit
fillPrice = ceilToTick(quote.price + ceil(quote.price × entrySlippageBps / 10,000))
```

报价已到达或跌破计划止损价时拒绝入场，避免在保护价已触发后新开仓。最终成交数量还受未成交订单数量、保留资金和风险预算约束；对原计划止损价及已有 fill 以实际价格重算累计风险。向上跳空后最多只成交仍符合原批准风险预算的交易单位；无合法单位时记录拒绝尝试并保持订单未成交/部分成交状态和预留。该规则不把 2% 计划风险描述成损失上限。

佣金按订单累计成交量计费：本次入账费用等于 `fee(cumulativeFilledShares) - feesChargedMinor`，因此多次部分成交不会重复收取最低佣金。成交价格、整数货币最小单位费用、FX 来源/汇率、quote 市场时间、实际执行时间和结算日均写入只追加的 fill/ledger 记录。相同订单与 quote source record 的重放返回既有成交，不再次扣款。订单投影、状态事件、fill、费用和账本流水在同一短事务内提交。

结算日期基于已版本化的市场营业日历：US 使用 `us-t1-2024-v1`，JP 使用 `jp-t2-2019-v1`；超出本地日历覆盖范围时拒绝成交。当前仓库没有已核验的实时行情 Provider，因此即使撮合内核已实现，运行时没有合格真实报价仍不能创建 fill。卖出/止损退出撮合和卖出款结算目前尚未实现，不能据此声称模拟账户覆盖完整交易生命周期。

## 集中度报告

对权益可核验的账户，按已核验的 JPY 市值计算直接持仓集中度；对拟议订单另列成交后的投影，不把未成交预留伪装成已持有：

```text
instrumentExposureJPY(i) = verifiedMark(i) × positionQty(i)
                            × FXJPYper(quoteCurrency(i))
issuerConcentration = knownIssuerExposureJPY / verifiedEquityJPY
sectorConcentration = knownSectorExposureJPY / verifiedEquityJPY
currencyConcentration(c) = netCashAndHoldingsExposureJPY(c) / verifiedEquityJPY
```

`netCashAndHoldingsExposureJPY(c)` 是币种 `c` 的已结算现金、未结算应收/应付、以 `c` 报价的持仓市值及该币种负债净额，再按有效 `FXJPYper(c)` 折算。拟议计划的投影额为当前已知组暴露加上该发行人/行业/币种的未成交买入承诺和本计划买入承诺，除以本次核验权益；未成交承诺仍不计作当前持仓。可报告证券、发行人、行业和币种的当前/投影暴露；仅在来源提供稳定、可核验的发行人或行业分类时归组。未能归组的暴露列为 `UNKNOWN`，不得假定为零或推断 ETF 未提供的底层成分。集中度在 V1 是风险披露，不是自动裁决阈值；没有经需求批准的数字上限，不得将它变成隐藏拒绝规则。

## 裁决顺序与失败语义

| 条件                                                                                     | 裁决         | 结果                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已确认证券类型/市场/方向违反只做多资产范围；止损不低于入场；计划数量不是合法交易单位倍数 | `REJECT`     | 返回 `ASSET_NOT_ALLOWED`、`STOP_NOT_BELOW_ENTRY` 或 `INVALID_QUANTITY_UNIT`；不改计划、不写订单或成交。                                                                                                                   |
| 账户未初始化、权益/峰值/必要报价/FX/费用/单位/模型或必需资产分类无效、过期、冲突或缺失   | `UNRESOLVED` | 返回 `ACCOUNT_NOT_INITIALIZED`、`EQUITY_UNRESOLVED`、`ASSET_CLASS_UNVERIFIED`、`QUOTE_UNAVAILABLE`、`FX_UNAVAILABLE`、`COST_MODEL_UNAVAILABLE`、`TRADING_UNIT_UNAVAILABLE` 等具体缺失原因；不通过风险、不批准或创建订单。 |
| 已知可核验权益 `<= 0`                                                                    | `REJECT`     | 风险预算不构成新仓购买力。                                                                                                                                                                                                |
| 当前回撤 `>= 20%`                                                                        | `REJECT`     | 返回 `DRAWDOWN_LIMIT_REACHED`；阻断新增头寸，不自动平仓。                                                                                                                                                                 |
| `requestedQuantity > qMax`，或有效数据下 `qMax = 0`                                      | `REJECT`     | 返回 `RISK_BUDGET_EXCEEDED`、`INSUFFICIENT_SETTLED_CASH` 或 `NO_VALID_LOT`；不透支。                                                                                                                                      |
| 计划、证据、规则版本齐全，数量合法且满足全部 2%/20%/现金条件                             | `PASS`       | 记录可复算裁决；仍须同版本本地批准和服务端复核。                                                                                                                                                                          |

以上稳定原因码随裁决记录；按最早阻断阶段选择 `primaryReasonCode`，其他已确认问题可以列入 `reasonCodes`。`PASS` 不带拒绝原因码。状态码和原因码由服务端产生，不接收 AI 或客户端提供的裁决。

每个 `RiskDecision` 至少保存 `planVersionId`、`planHash`、状态和原因码、请求数量/`maxAllowedQuantity`、权益/峰值/回撤/预算/计划损失、各币种可用现金与购买承诺、集中度当前值和投影、输入证据 ID、风险/成本/FX 规则版本、计算版本、输入 hash 和裁决时间。金额/精确价格/数量通过 API 的十进制字符串与 scale 表达，不使用 JSON 浮点数。以上是不可变结果；输入变化必须产生新的裁决记录。

已知禁止条件优先返回 `REJECT`；没有已知禁止条件时，任一必要输入不可核验就返回 `UNRESOLVED`。这两种结果都禁止新增头寸。每次裁决以不可变记录保存 plan version、输入 hash、风险/成本/FX 规则版本、计算摘要、裁决码、原因和时间；重评追加新裁决，不覆写旧决定。

## 可手算边界决策表

以下是验收用的确定性示例，不是市场默认费率、真实数据或运行时代码测试结果。所有价格与费用在示例中均假定已按该证券 tick、币种和成本模型给定。

| 案例                     | 输入与计算                                                                                                                                                                                  | 预期                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2% 等号边界              | 权益 1,000,000 JPY；预算 `floor(1,000,000 × 0.02) = 20,000`。100 股，入场 1,000、止损 805，价格损失 `100 × 195 = 19,500`；有效成本模型给出的买入费与退出费各为 250 JPY，总损失 20,000 JPY。 | `PASS`（其他门禁通过）。200 股价格损失 39,000、费用 1,000、总损失 40,000 JPY，`REJECT`；任一合法数量超过预算都拒绝。  |
| 成本入预算               | 同上，一手 100 股，入场 1,000、止损 800，价格损失为 20,000；买入费和退出费各 250 JPY，总损失 20,500 JPY。                                                                                   | `REJECT`；不能省略费用。                                                                                              |
| 非正权益                 | 可核验权益为 0 或 -1 JPY。                                                                                                                                                                  | `REJECT`；不计算正数量，不能以初始化本金覆盖当前亏损。                                                                |
| 20% 峰值回撤             | 峰值 1,000,000 JPY，当前 800,000：回撤 20%。当前 800,100：回撤 19.99%。                                                                                                                     | 前者 `REJECT`；后者仅通过回撤门禁，仍须通过其他门禁。                                                                 |
| 无报价                   | 持仓缺少有效估值报价，或待评估计划无有效入场价。                                                                                                                                            | `UNRESOLVED`；不丢弃该持仓、不沿用过时报价、不假造成交。                                                              |
| 跳空预算                 | 100 股；入场参考价 1,000、止损 900、入场滑点 0、止损滑点 10、版本化跳空预算 30。假设入场 1,000、止损成交 860，计划价格损失 `100 × (1,000 - 860) = 14,000` JPY，费用/FX 另计。               | 价格损失可复算；若实际模拟成交价为 800，则价格损失为 20,000，必须按真实模拟价入账并报告超出计划风险，不能篡改为 860。 |
| 单价/单位超资金          | 初始可用现金 1,000,000 JPY；日股每手 100 股；入场 12,000、止损 11,900。计划风险每手 10,000 JPY，但买入本金 1,200,000 JPY，尚未计费。                                                        | `REJECT`；`qMax = 0`，禁止透支。                                                                                      |
| USD 风险换算             | USD 计划损失 100；有效观测 150 JPY/USD；该示例版本的 FX 缓冲为 500 bps，保守汇率 `150 × 1.05 = 157.5`，折合 15,750 JPY（另加转换成本）。                                                    | 使用来源和规则版本保存后可复算；缺 FX 或规则版本为 `UNRESOLVED`。500 bps 是本示例输入，不是系统默认。                 |
| 集中度                   | 可核验权益 1,000,000 JPY；发行人 A 的现有直接暴露 180,000，新计划投影增加 70,000；投影占比 `250,000 / 1,000,000 = 25%`。                                                                    | 披露 25% 投影暴露；没有获批的集中度阈值时不以 25% 自动拒绝或宣称其风险已获批准。                                      |
| 只有 JPY 现金买 USD 股票 | 账户有 JPY 现金，没有 USD 已结算现金，也没有有效模拟 FX 转换事件。                                                                                                                          | `REJECT` 购买力不足；不隐式换汇或透支。若 FX 数据本身缺失导致风险损失不能换算，则 `UNRESOLVED`。                      |

## 离线、凭据与 Fixture

| 数据状态                                     | 允许行为                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 离线但已保存数据仍满足各自来源新鲜度和有效期 | 可用同一输入/规则 hash 重算；不因离线本身伪装 `REAL`。不合格或已过期即 `UNRESOLVED`。                            |
| 无供应商凭据/授权                            | 不尝试未经授权的数据源，不伪造价格、FX、成本或裁决；必要输入缺少时 `UNRESOLVED`。                                |
| 无当前有效行情/报价                          | 账本和已保存材料仍可读；新增计划不得 `PASS`，纸面模拟成交不得发生。合法历史数据只用于有相应输入的历史回测。      |
| Fixture 上游                                 | 所有派生结果保持 `DEMO_ONLY`，仅供隔离演示；不写入可被误认为实证的 paper ledger，不能成为可批准的运行时 `PASS`。 |

## 后续实现边界

P04/P07 验证实际价格/FX/费用来源的覆盖、时效、方向与许可；P05/P10 实现精确数值、估值、现金预留、账本与服务端风控调用；P09 实现历史撮合的费用和跳空语义；P12 运行边界与审计测试。若任何输入缺证据，输出 `UNRESOLVED` / `NOT_VERIFIED`，不得用 fixture、零费用、现代证券池或推测性 FX 补齐。
