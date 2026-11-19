# Quant Research Workbench — 开发总计划

> V1 / 本地优先 / GitHub Issues 驱动 / 2026-11-15 基线。
> 请先阅读根目录 `AGENTS.md`；本文件描述范围、顺序和阶段验收，具体执行由对应 GitHub Issue 负责。 

## 目标与非目标

- 产品：美股/日股研究晨报、重大新事件监测、AI 六角色研究、统计回测、独立风险官、持久化纸面模拟账本、本地任务和审计。
- 基础栈：Next.js App Router + React/TypeScript strict + Tailwind/shadcn/ui + SQLite/Drizzle + Codex SDK + 独立 Node Worker；测试 Vitest + Playwright。
- 资金红线：纸面初始 1,000,000 JPY；每笔预期最大损失不得超过可核验当期权益 2%；权益较历史峰值回撤达 20% 立即禁止新仓；仅普通股票及无杠杆 ETF。
- 禁止：真实订单、真实证券账户连接、杠杆、期权、卖空、自动付费或未知外发。AI 不可直接改写账本、风险决定或宣布成交。
- 外部行情/财报/公告必须可溯源；区分真实、延迟、历史和 Fixture；数据不足使用 NOT_VERIFIED；不得编造回测、价格和收益。

## 角色与过程约定

六个研究角色是职责分工（统筹、情报、市场结构、策略、独立风控、模拟员），不要求部署六个独立 Agent。研究输出经 Schema 校验和证据核对，任何新纸面计划仍须由确定性风控审批。

每次 Codex 工作应：核对仓库与 Issue → 读取相关设计（按需检索）→ 编写失败测试/实现 → 运行验证 → 更新提交和执行证据 → 留下短交接摘要 → 执行下一个无阻断任务。

执行状态遵循 `PENDING → RUNNING → DONE` 或 `BLOCKED/FAILED`，每个 Issue 有唯一 ID；单工作树单写入者；失败限次自动修复，认证、收费、权限和安全风险必须安全暂停。机器关机/休眠不能保证全天连续运行。详见 `AGENTS.md`、`docs/CONTEXT_ENGINEERING.md`。

## 阶段总览

| 阶段 | 目标 | 原子任务数 | 交付门禁 |
|---|---|---:|---|
| P00 工程创建与自主执行基础 | 在现有空白仓库构建 Next.js 应用、Codex 自主执行器及持久化交接机制。保留 #1 为阶段主 Issue。 | 5 | 依赖锁定、基础构建、单写入者执行、断点续跑与上下文交接测试通过。 |
| P01 需求设计 | 将美日股研究平台的四类自动任务、用户行为、风险与不可做事项转成可验收需求。 | 4 | 全部 V1 功能有 ID、优先级、验收案例；非功能需求和安全边界可追踪。 |
| P02 系统基本设计 | 设计单机 Next.js + 独立 Worker + SQLite + Codex 的稳定边界。 | 4 | 进程、模块、数据流、信任边界、异常和失效模式均可审核。 |
| P03 详细设计 | 把架构转成表、接口、状态机、算法和可执行测试契约。 | 5 | 关键模型的边界、精度、异常语义与事务约束明确且可测试。 |
| P04 技术可行性验证 | 在大规模实现前证实关键外部依赖与离线降级路径。 | 4 | 四项 PoC 各有真实调用/测试证据或明确 BLOCKED_EXTERNAL，不以示例冒充成功。 |
| P05 数据与工程基础实现 | 实现可持久化、可审计、可测试的跨模块基础设施。 | 5 | 迁移、输入校验、来源记录和故障恢复通过；本地开发运行稳定。 |
| P06 React UI 与体验实现 | 提供清晰的研究工作台、可用交互、错误与数据时效标识。 | 6 | 核心页面可用，Playwright 可走通无真实交易的主要流程。 |
| P07 行情与公开信息采集实现 | 接入合法、可审计、可降级的美日行情、公告、宏观和交易日历。 | 5 | 交易时段/时效/来源/去重测试通过；无凭据时 Fixture 路径清晰。 |
| P08 Codex 六角色研究执行 | 构建证据驱动的 AI 研究流程及受控输出，不把模型推断当成交结果。 | 5 | 以可核查样本生成晨报/异常/审计；无来源或工具失败时保持正确限制。 |
| P09 指标、回测与量化验证 | 用确定性算法验证统计优势，缺少历史数据不得产生虚假绩效。 | 6 | 可复算回测、成本/样本外/历史压力测试均通过单测，实际数据不足则保持 NOT_VERIFIED。 |
| P10 纸面模拟与独立风控 | 实现合规、不可伪造的纸面账户账本和单笔2%/峰值回撤20%硬限制。 | 5 | 权益/现金/FX/止损/幂等/否决的边界测试全部通过；无任何真实交易接口。 |
| P11 自动任务、监测与通知 | 在本机可靠执行四类任务，严格按日美常规交易窗口做盘中扫描，且只通知真正新信息。 | 5 | 交易日历、重试恢复、事件去重与重大通知均在故障注入测试中通过。 |
| P12 完整测试与安全质量审计 | 用可重复的自动化证据证明业务规则与本地运行可靠，发现阻断缺陷并修复。 | 6 | typecheck/lint/build/单测/集成/E2E 完整通过，阻断级问题为零，外部阻断明确披露。 |
| P13 本地发布与交付 | 交付可复现的离线优先本地应用和完整可审计文档。 | 4 | 新环境按文档安装运行成功；部署不含外部真实交易和任何虚假测试结论。 |

**当前范围：14 个阶段、69 个原子任务；阶段 Issue P00 使用既有 #1，其他阶段和原子任务以同名 Issue ID 关联。**

## 依赖顺序和实施策略

1. P00 启动工程与恢复执行器（包含 NVIDIA 短上下文交接），但此时**不得**以占位文件宣称 P00 完成。
2. P01–P03 完成需求/基本设计/详细设计；先稳定可测试契约，再全面编码。
3. P04 先验证 Codex SDK、市场数据、SQLite、独立 Worker。无法取得第三方凭据时按外部阻断记录并建设明确标记的 Fixture 离线演示，不作为真实接入通过。
4. P05–P08 实现数据库、UI、数据源、AI；P09–P11 实现量化计算、纸面交易、监测调度；P12–P13 进行安全、测试、交付。
5. P01–P13 内可以按每个子 Issue 的具体依赖并行**分析**，但同一工作树只允许一个写入中的 Codex 任务；不跨过关键依赖或自动合并。

## 原子任务清单

### P00 — 工程创建与自主执行基础

**目标：**在现有空白仓库构建 Next.js 应用、Codex 自主执行器及持久化交接机制。保留 #1 为阶段主 Issue。
**阶段验收：**依赖锁定、基础构建、单写入者执行、断点续跑与上下文交接测试通过。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P00-01`](https://github.com/OYLPY/stock-monitor/issues/15) | **创建 Next.js 应用与可复现环境**：检查 main 的现存文件；采用 Next.js App Router、TypeScript strict、Tailwind、pnpm 创建工程；锁定 Node LTS 与依赖版本；不得覆盖现有内容。 | package.json、pnpm-lock.yaml、tsconfig、src/app 页面、启动说明 | 新克隆后 pnpm install --frozen-lockfile、pnpm dev、build 和类型检查通过；禁止硬编码开发机绝对路径；依赖：无 |
| [`P00-02`](https://github.com/OYLPY/stock-monitor/issues/16) | **建立质量、安全和仓库协作规范**：确认根目录 AGENTS.md 的红线；实现 Lint、格式检查、单测命令、.env.example、Git 忽略规则和仓库交付策略；不提交密钥。 | package scripts、配置、README、.gitignore、质量检查工作流 | lint/typecheck/test 可运行；敏感文件不被追踪；按当前授权直接推送 main，检查成功后关闭关联 Issue；依赖：P00-01 |
| [`P00-03`](https://github.com/OYLPY/stock-monitor/issues/17) | **实现 Codex 自动任务执行器**：使用当前可用 Codex SDK 及受控任务列表；实现任务依赖、单实例锁、子任务超时、原子任务状态写入、最多3次修复、可恢复状态机；禁止自动放宽权限。 | scripts/autopilot、harness/state、任务 Schema、执行记录 | 重复启动不并发写入；无凭据明确 BLOCKED_EXTERNAL；DONE 不重复执行；每步有实际退出码；依赖：P00-02 |
| [`P00-04`](https://github.com/OYLPY/stock-monitor/issues/18) | **NVIDIA 短上下文压缩与交接能力**：落实 AGENTS.md 与 docs/CONTEXT_ENGINEERING.md；任务上下文按需读取；六字段交接、上下文重启、重新验证证据；EoCC 默认、SAC 仅实验评估。 | harness/handoffs 模板、上下文构造器、恢复示例 | 跨会话保留目标/事实/改动/验证/死路/下步动作；不丢安全规则；不杜撰截断日志；依赖：P00-03 |
| [`P00-05`](https://github.com/OYLPY/stock-monitor/issues/19) | **P00 故障恢复与阶段验收**：故障注入测试进程中断、锁、退出码、重复任务、状态损坏与超时；验证可完成一次离线样本任务。 | tests/autopilot、恢复报告、P00 完成证据 | 重启后能按任务继续，不重复 DONE；失败不被标记成功；记录命令和耗时；依赖：P00-03, P00-04 |

### P01 — 需求设计

**目标：**将美日股研究平台的四类自动任务、用户行为、风险与不可做事项转成可验收需求。
**阶段验收：**全部 V1 功能有 ID、优先级、验收案例；非功能需求和安全边界可追踪。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P01-01`](https://github.com/OYLPY/stock-monitor/issues/20) | **PRD 与用户场景/范围**：定义本地个人研究用户、晨报/监测/研究审计/周审计闭环、六研究角色、UI导航、V1范围及非目标；拆分联机与离线能力。 | docs/requirements/PRD.md、用例图、需求清单 | 每个用户旅程有触发、输入、预期结果和异常路径；不含真实交易服务；依赖：P00-02 |
| [`P01-02`](https://github.com/OYLPY/stock-monitor/issues/21) | **晨报、异常监控与 AI 研究功能需求**：定义市场日历、仅交易时段监测、重大事件判定、最多3个新事件、去重、来源时间戳；晨报经济日历、3策略、风险裁决、可验证性等级。 | FR-Research 编号、工作流、报告契约 | 正常/休市/午休/无新闻/旧新闻/数据过期/缺少来源均有验收案例；依赖：P01-01 |
| [`P01-03`](https://github.com/OYLPY/stock-monitor/issues/22) | **纸面交易、回测、风控需求**：区分候选、计划、审批、模拟挂单/成交与账本；明确初始100万JPY、当前权益2%风险、历史峰值20%回撤；仅多头股票及非杠杆ETF。 | FR-Trade、风控公式规范、交易状态图 | 测试覆盖权益不可核验、跳空、滑点、最小交易单位、汇率、禁止杠杆/期权/做空；依赖：P01-01 |
| [`P01-04`](https://github.com/OYLPY/stock-monitor/issues/23) | **非功能需求与验收追踪矩阵**：定义性能、可恢复性、离线降级、凭据保护、审计、备份、数据质量、语言和无障碍；为所有功能关联设计/测试编号。 | [`NFR.md`](requirements/NFR.md)、[`TRACEABILITY.md`](requirements/TRACEABILITY.md) | 不存在缺少验收标准的 MUST 功能；不能把 Fixture 结果当作真实外部联通；依赖：P01-02, P01-03 |

### P02 — 系统基本设计

**目标：**设计单机 Next.js + 独立 Worker + SQLite + Codex 的稳定边界。
**阶段验收：**进程、模块、数据流、信任边界、异常和失效模式均可审核。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P02-01`](https://github.com/OYLPY/stock-monitor/issues/24) | **系统上下文、容器及模块分层**：确定浏览器 UI、Next.js Node 运行时、独立 Worker、Codex SDK、数据适配器、SQLite；设计 feature/domain/infrastructure 分层。 | [ARCHITECTURE.md](design/ARCHITECTURE.md)：系统上下文、模块分层、运行拓扑及信任边界 | 明确每层职责、同步/异步接口、禁止浏览器直接接触凭据及账本写权限；本地即开即用、无登录/用户管理；UI 基线 shadcn/ui；依赖：P01-04 |
| [`P02-02`](https://github.com/OYLPY/stock-monitor/issues/25) | **市场数据与证据溯源架构**：设计行情快照、公司IR、EDINET、SEC、新闻、公告及经济日历适配器；区分市场时间/采集时间/来源发布时间、数据时效和可信等级。 | [DATA_PROVENANCE.md](design/DATA_PROVENANCE.md)、[来源核验记录](research/P02-02-DATA-SOURCE-FINDINGS.md)、统一数据契约 | 可表达延时/历史/Fixture/缺失/冲突来源；无法核实的数据不能变成正式信号；依赖：P02-01 |
| [`P02-03`](https://github.com/OYLPY/stock-monitor/issues/26) | **AI 六角色编排与确定性风控边界**：明确统筹/侦察/结构/策略/风控/模拟员的输入输出，选择单模型串行编排；AI 输出经结构和证据引用校验后才进入下一步；风险官有否决权。 | [AI_WORKFLOW.md](design/AI_WORKFLOW.md)：串行流程、角色 I/O 与权限矩阵、失败关闭及风险边界 | 模型不能变更订单、权益或风险限制；所有判断回链证据；确定性风险和本地同版本批准通过前不产生模拟交易副作用；依赖：P02-01 |
| [`P02-04`](https://github.com/OYLPY/stock-monitor/issues/27) | **ADR 与安全/运行故障设计**：记录 SQLite 与 IndexedDB、Codex SDK 与 App Server、独立 Worker 与前端定时器等权衡；威胁建模、启动/休眠/断网/重启行为。 | [ADR-0001–0003](decisions/)、[THREAT_MODEL.md](design/THREAT_MODEL.md)、[FAILURE_MODES.md](design/FAILURE_MODES.md) | 关键决策有替代方案和失效处理；安全边界及外部授权/运行时待验证项可追踪；不依赖浏览器存活保证后台监控；依赖：P02-01, P02-02, P02-03 |

### P03 — 详细设计

**目标：**把架构转成表、接口、状态机、算法和可执行测试契约。
**阶段验收：**关键模型的边界、精度、异常语义与事务约束明确且可测试。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P03-01`](https://github.com/OYLPY/stock-monitor/issues/28) | **SQLite Schema、迁移与账本不变量**：设计行情、证券、事件、研究、策略、订单、成交、现金流水、权益、通知、任务状态；约束外键、唯一键、审计不可变记录。 | docs/design/DB_SCHEMA.md、迁移草案、ER图 | 主键稳定；模拟成交幂等；流水不可被 AI 直接覆盖；备份恢复有版本标识；依赖：P02-01, P01-03 |
| [`P03-02`](https://github.com/OYLPY/stock-monitor/issues/29) | **API/DTO 与状态机契约**：设计 Next.js Route Handlers、Zod Schema、错误码、分页、报告输出、任务执行、计划审批、时间/货币/数值精度；禁止开放真实交易API。 | docs/design/API_CONTRACTS.md、状态图 | 请求参数和 AI 输出均可校验；异常有清晰 HTTP/业务码；权限不靠客户端校验；依赖：P02-01, P03-01 |
| [`P03-03`](https://github.com/OYLPY/stock-monitor/issues/30) | **风险算法与订单仓位计算**：精确定义初始与当前权益、JPY/USD FX、持仓估值、风险单位、佣金/滑点/缺口预算、峰值回撤、头寸集中度；禁止透支。 | docs/design/RISK_ENGINE.md、边界决策表 | 2%与20%边界、非正权益、无报价、跳空和单价超资金等测试用例可复算；依赖：P03-01 |
| [`P03-04`](https://github.com/OYLPY/stock-monitor/issues/31) | **指标/回测与评分详细设计**：定义 OHLCV 复权、交易日边界、ATR/MA/实现波动、日内/日级成交语义、手续费模型、walk-forward、2020/2022 压力、五维评分与缺失状态。 | docs/design/BACKTEST_ENGINE.md、评分契约 | 无未来函数、同根K线成交限制、样本不足 NOT_VERIFIED、18/25 不是自动交易许可；依赖：P03-01, P01-03 |
| [`P03-05`](https://github.com/OYLPY/stock-monitor/issues/32) | **任务调度、事件指纹、通知与上下文状态机**：定义市场时段判定、任务幂等键、失败重试、事件去重、重大性阈值、Codex 六字段交接和持久化恢复协议。 | docs/design/SCHEDULER.md、WORKFLOW_STATE.md | 周末/午休/夏令时不扫描；重复新闻不提醒；任务中断/压缩后保留可验证进度；依赖：P02-04, P03-02 |

### P04 — 技术可行性验证

**目标：**在大规模实现前证实关键外部依赖与离线降级路径。
**阶段验收：**四项 PoC 各有真实调用/测试证据或明确 BLOCKED_EXTERNAL，不以示例冒充成功。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P04-01`](https://github.com/OYLPY/stock-monitor/issues/33) | **Codex SDK 本地授权与流式调用 PoC**：验证本地 Codex CLI/SDK 授权方式、基本调用、响应 Schema、失败/限额处理、允许的文件权限；不暴露令牌给浏览器。 | poc/codex、实际日志（脱敏）、接入说明 | 有真实成功调用记录或明确外部阻断；过时文档差异登记 ADR；依赖：P03-02 |
| [`P04-02`](https://github.com/OYLPY/stock-monitor/issues/34) | **SQLite/Drizzle 精度与迁移 PoC**：测量整数JPY、定点USD和汇率精度方案；验证并发事务、迁移、回滚及单机锁竞争。 | poc/sqlite、Schema 验证脚本 | 重启可读；无浮点资金漂移；重复迁移幂等；错误写入原子回滚；依赖：P03-01 |
| [`P04-03`](https://github.com/OYLPY/stock-monitor/issues/35) | **美日历史/公告数据适配器 PoC**：调研官方/可信来源的实际可访问性、授权、频率限制、数据时间戳、费用；避免臆造免费实时源；准备合法 Fixtures。 | docs/research/DATA_SOURCES.md、poc/market-data | 源支持的频度/许可有原始出处；缺少 Key 时离线样本可复现且显著标记；依赖：P02-02 |
| [`P04-04`](https://github.com/OYLPY/stock-monitor/issues/36) | **后台 Worker、关闭浏览器及重启恢复 PoC**：验证独立 Node 调度器、Next.js API 共用模块、系统睡眠/重启/异常退出处理，比较 macOS/Windows 本地调度方式。 | poc/worker、运行手册、故障注入结果 | 关闭页面后 Worker 在进程仍运行条件下继续；PC 睡眠/关机不会谎称监控；恢复幂等；依赖：P03-05 |

### P05 — 数据与工程基础实现

**目标：**实现可持久化、可审计、可测试的跨模块基础设施。
**阶段验收：**迁移、输入校验、来源记录和故障恢复通过；本地开发运行稳定。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P05-01`](https://github.com/OYLPY/stock-monitor/issues/37) | **建立数据库、迁移及仓储层**：实现 Drizzle schema/migrations、SQLite WAL 适用配置、主键唯一键及事务封装；版本化初始资金配置。 | src/db、migrations、测试数据库工厂 | 新库迁移/重复启动/事务回滚/并发冲突测试通过；不生成虚假成交；依赖：P04-02 |
| [`P05-02`](https://github.com/OYLPY/stock-monitor/issues/38) | **统一时间、金额、货币与市场标识**：定义 Asia/Tokyo / America/New_York 时间工具、精确小数/整数金额、汇率单位、证券符号+交易所复合标识。 | src/domain/primitives、单测 | DST转换、JPY/USD舍入、时区日期与交易日跨日映射均可复算；依赖：P03-02 |
| [`P05-03`](https://github.com/OYLPY/stock-monitor/issues/39) | **输入 Schema、API 基础设施与安全设置**：实现 Zod 输入验证、统一错误处理、本地访问保护、密钥环境变量与日志脱敏、数据导入边界。 | src/lib/api、src/lib/security、.env.example | 恶意/过大输入拒绝，API 不回显密钥；没有任何真实下单路由；依赖：P05-01, P05-02 |
| [`P05-04`](https://github.com/OYLPY/stock-monitor/issues/40) | **事件与来源仓储及审计历史**：实现消息来源、行情引用、内容 hash、采集时间、版本与只追加审计日志；不可验证状态的显式表示。 | src/features/evidence、仓储/单测 | 事件和引用可追溯、重启后仍在；缺来源不能被标记 VERIFIED；依赖：P05-01, P05-03 |
| [`P05-05`](https://github.com/OYLPY/stock-monitor/issues/41) | **备份、恢复和数据库完整性验证**：实现本地数据导出备份、导入预检、schema版本校验、事务性恢复及损坏报告；避免删除旧数据。 | scripts/backup、scripts/restore、docs/operations/backup.md | 全新本地环境可恢复已知测试账本；错误备份不覆盖当前数据库；依赖：P05-01, P05-04 |

### P06 — React UI 与体验实现

**目标：**提供清晰的研究工作台、可用交互、错误与数据时效标识。
**阶段验收：**核心页面可用，Playwright 可走通无真实交易的主要流程。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P06-01`](https://github.com/OYLPY/stock-monitor/issues/42) | **设计系统和应用壳层**：建立 typography/spacing/color/token、shadcn/ui、侧边栏、导航、响应式布局、中文文案；保持信息层次和可访问性。 | src/components/ui、layout、design guidelines | 桌面与窄屏无严重错位；键盘/焦点/空态有基本覆盖；依赖：P05-03 |
| [`P06-02`](https://github.com/OYLPY/stock-monitor/issues/43) | **美日市场 Dashboard 与行情图表**：实现市场开闭市状态、行情快照、更新时间、币种、来源、趋势与历史图；不展示假实时价格。 | Dashboard 页面、K线/时间序列组件 | 无行情/延时/Fixture/历史数据有显著区别；时间点与时区正确；依赖：P06-01, P05-04 |
| [`P06-03`](https://github.com/OYLPY/stock-monitor/issues/44) | **异常监测与事件证据中心**：实现事件列表、重要性、发现时间、源链接、去重归并、风险评估与详情；仅新高等级事件才显示通知状态。 | 事件页面、来源详情、筛选 | 同事件重复消息合并；缺少证据不显示已验证徽标；依赖：P06-01, P05-04 |
| [`P06-04`](https://github.com/OYLPY/stock-monitor/issues/45) | **晨报及六角色策略研究工作台**：实现晨报阅读、候选策略、证据/推论/假设标注、六角色审计及风控否决原因；支持报告历史。 | Reports/Strategies 页面 | 最多3策略可追踪；无数据/AI失败时不给虚假量化分数；依赖：P06-01, P05-04 |
| [`P06-05`](https://github.com/OYLPY/stock-monitor/issues/46) | **回测与纸面模拟账户界面**：实现参数配置、实验结果、费用/风险明细、账本流水、权益曲线、模拟订单状态；禁用所有真实交易按钮。 | Backtests/Paper Ledger 页面 | NOT_VERIFIED 正确显示；无账本明确“未建立”；禁止绕过风控直接写入；依赖：P06-01, P05-01 |
| [`P06-06`](https://github.com/OYLPY/stock-monitor/issues/47) | **设置、任务日志、通知及 E2E 页面验收**：实现数据源/模型设置、任务状态、执行日志、备份入口；统一错误提示与屏幕阅读语义；加入Playwright冒烟。 | Settings/Tasks 页面、E2E | 所有用户操作有实际行为和失败反馈；设置不泄露 token；依赖：P06-02, P06-03, P06-04, P06-05 |

### P07 — 行情与公开信息采集实现

**目标：**接入合法、可审计、可降级的美日行情、公告、宏观和交易日历。
**阶段验收：**交易时段/时效/来源/去重测试通过；无凭据时 Fixture 路径清晰。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P07-01`](https://github.com/OYLPY/stock-monitor/issues/48) | **NYSE/Nasdaq/JPX 交易日历与时段判定**：实现本地交易所日历、周末、特休、提前收市、东京午休、美国DST；日历来源有版本和最近核查时间。 | src/features/market-calendar、校验样本 | 覆盖 EST/EDT 切换、当地假日、周末、东京午休、临时休市覆盖规则；依赖：P05-02, P04-03 |
| [`P07-02`](https://github.com/OYLPY/stock-monitor/issues/49) | **美股行情/历史数据适配器**：建立 Provider 统一接口、时间戳、币种、数据延时和权限限制；支持来源替换、限流、缓存、失败降级与样本回放。 | src/providers/us-market、Mock/Fixture、集成测试 | 不能把缓存当实时；价格及OHLCV校验；缺 API 凭据时标注不可用；依赖：P07-01, P05-04 |
| [`P07-03`](https://github.com/OYLPY/stock-monitor/issues/50) | **日股行情/历史数据适配器**：调研并实现 JPX / J-Quants / 合规数据源的可用接口；日元、100股单位与 ETF 交易单位按证券元信息确定；不得宣称 J-Quants 实时。 | src/providers/jp-market、数据源说明 | 能够区分历史/延迟/Fixture，数据缺失不编造；交易日期转换准确；依赖：P07-01, P05-04 |
| [`P07-04`](https://github.com/OYLPY/stock-monitor/issues/51) | **公司公告、财报与官方宏观采集**：统一 SEC EDGAR、公司 IR、EDINET、TDnet、BOJ、Fed/BLS/BEA 官方原始材料的引用适配器；合规请求频率、去重、来源时间。 | src/providers/disclosures、docs/research/SOURCES.md | 同一公告多网址不重复；外部源不可用时明确降级；来源可靠性可追查；依赖：P07-01, P05-04 |
| [`P07-05`](https://github.com/OYLPY/stock-monitor/issues/52) | **事件归一化、新旧判断与数据质量门禁**：建立事件实体识别、证券映射、指纹/内容哈希、时区对齐、重大性候选、采集误差与新鲜度门禁；不凭 AI 断言唯一真实性。 | src/features/events/normalizer、quality gate | 旧新闻和重复报道不升级；不同事件不误合并；过期价量不能触发实时信号；依赖：P07-02, P07-03, P07-04 |

### P08 — Codex 六角色研究执行

**目标：**构建证据驱动的 AI 研究流程及受控输出，不把模型推断当成交结果。
**阶段验收：**以可核查样本生成晨报/异常/审计；无来源或工具失败时保持正确限制。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P08-01`](https://github.com/OYLPY/stock-monitor/issues/53) | **Codex SDK 服务封装与任务隔离**：实现服务端 Codex 连接、会话/流式事件、重试/取消/调用审计、速率限制、权限边界；避免无界模型调用。 | src/features/ai/codex-adapter、测试桩 | 成功输出有来源与调用追踪；失败/限额/超时可恢复，不泄露认证信息；依赖：P04-01, P05-03 |
| [`P08-02`](https://github.com/OYLPY/stock-monitor/issues/54) | **六角色结构化研究工作流**：实现统筹→情报→市场结构→策略研究→独立风控→模拟员的单进程可分步骤执行；定义角色输入/输出、独立否决点。 | src/features/research/workflows、Zod 契约 | AI角色不能写账本；角色未完成时报告显式不完整；否决阻止后续提案；行情证据缺失时归档未核验输出且候选为空；依赖：P08-01, P07-04 |
| [`P08-03`](https://github.com/OYLPY/stock-monitor/issues/55) | **研究证据引用与反幻觉校验**：实现引文映射到实际采集证据、时间戳验证、事实/推论/假设区分、数字单位交叉检查与无来源降级；拒绝伪造 TradingView 实时读取。 | src/features/research/evidence-checker、测试 | 伪造URL、错误时间、过期数字、缺失资料不会通过 VERIFIED；依赖：P08-02, P07-04 |
| [`P08-04`](https://github.com/OYLPY/stock-monitor/issues/56) | **晨报/异常报告/每日与每周审计生成**：按需求输出美日最新完成交易日、五行摘要、未来24小时事件、≤3策略及五维验证状态、风控裁决、账本状态；支持报告归档与再次生成。 | src/features/reports、报告模板、测试 | 休市正确说明；未完成的美股交易日不可写成已完成；资料不足只归档 NOT_VERIFIED 且无候选；依赖：P08-02, P08-03 |
| [`P08-05`](https://github.com/OYLPY/stock-monitor/issues/57) | **AI 研究固定样本回归与上下文交接**：对 FIXTURE 长历史、现有 task/restart context builder 与 SAC 离线 checkpoint 进行可复现比较；三次重复检查关键上下文标记和来源 ID 规则；预算只记录 UTF-8 bytes，不测量模型准确率、token 或费用，也不调用模型/行情。 | tests/ai-evals、harness/evidence、harness/handoffs | 保留验收、风险和来源 ID；未知来源被拒绝；至少三次结果确定；SAC 只作 fixture 对照，项目 task/restart 不宣称为生产 EoCC；依赖：P08-03, P00-04 |

### P09 — 指标、回测与量化验证

**目标：**用确定性算法验证统计优势，缺少历史数据不得产生虚假绩效。
**阶段验收：**可复算回测、成本/样本外/历史压力测试均通过单测，实际数据不足则保持 NOT_VERIFIED。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P09-01`](https://github.com/OYLPY/stock-monitor/issues/58) | **OHLCV 归一化与指标库**：按有来源、收盘时点和 bar 可用时点的预期交易日映射日线 OHLCV；仅对当时已生效且不晚于有效 bar 数据可用时点可知的拆股重基指标历史，分红不用于信号价格，缺口重置窗口。实现 Wilder ATR(14)、SMA(n)、简单/对数日收益、n 日对数收益样本标准差、线性 P05/P50/P95 和 RSI(14)，统一 8 位定点精度，不默认年化。 | src/features/quant/indicators、单测数据 | 手算 Fixture 与代码一致；首 bar 不伪造 TR；未知可用时间、迟到公司行动、缺日历/行情和缺口有明确状态；依赖：P05-02。行情源接入 P07-02/P07-03 独立推进；Fixture 不得宣称真实行情。 |
| [`P09-02`](https://github.com/OYLPY/stock-monitor/issues/59) | **无未来函数的回测撮合引擎**：信号数据可用后只尝试下一时段开盘；使用未复权开盘价、开盘点时、按有效期版本化的费用和累计成交量上限；按来源规则结算卖出应收，处理拆股、分红、缺口及资金持仓；可确定性重播。 | src/features/backtest/engine、Fixture | 禁止同 bar/同开盘先知成交；开盘价迟到/缺失不成交、不顺延；费用或结算规则缺失时不撮合/不伪称可信；成交现金/持仓非负；Fixture 为 DEMO_ONLY；相同输入输出一致；依赖：P09-01, P03-04 |
| [`P09-03`](https://github.com/OYLPY/stock-monitor/issues/60) | **三类初始策略与参数边界**：提供财报后漂移、趋势/放量突破、过度反应均值回归的严格参数 Schema 和确定性信号；不自动优化参数。财报事件按发布时间和可用时间参与，趋势窗口按点时拆股重基，RSI 保留完整来源链。 | src/features/strategies、参数 Schema、Fixture 用例 | 三种规则可重复调用；固定股数符合交易单位；完整入场/退出/止损/持有期限；缺少本次决策所需数据时不发信号并返回原因；Fixture 为 DEMO_ONLY；信号交 P09-02 下一开盘撮合；依赖：P09-01, P09-02 |
| [`P09-04`](https://github.com/OYLPY/stock-monitor/issues/61) | **样本内/样本外与 Walk-forward 实验**：实现 expanding/rolling 时间折、隔离期、训练窗独占参数选择和冻结 hash、逐折交易收益统计及显式区块长度的确定性 circular block bootstrap。 | src/features/validation、测试报告 | 测试窗不参与选参且互不重叠；每折至少 30 笔闭合交易、无遗留仓位且数据可信才可标记 VERIFIED；不足时 NOT_VERIFIED、Fixture 为 DEMO_ONLY；相同输入可重算；依赖：P09-02, P09-03 |
| [`P09-05`](https://github.com/OYLPY/stock-monitor/issues/62) | **2020/2022 压力与费用/汇率敏感性**：确定性重跑基线与显式费用、跳空滑点准备金、流动性容量及点时 FX 场景；以完整窗口证据门控历史指标，无真实数据时 `NOT_VERIFIED`。 | `src/features/validation/stress-test.ts`、定向测试、设计/需求追踪 | 窗口边界、来源、参数和选参历史可追溯；FX 不前向填充；Fixture 为 `DEMO_ONLY`；同一成交集合下增加成本不得改善净权益，成交变化须显式标出；依赖：P09-04 |
| [`P09-06`](https://github.com/OYLPY/stock-monitor/issues/63) | **五维评分与 18/25 验证候选门禁**：样本外稳定、扣费收益、最大回撤、成交可行性、跨环境稳健各1–5；由显式版本化校准规则按可追溯指标确定；缺项不打分；≥18仅标记待风控审批候选。 | `src/features/validation/scoring.ts`、契约/测试 | 阈值须严格递增且具历史校准证据；缺实证不出现伪分数；Fixture 为 `DEMO_ONLY`；≥18不能绕过风控；依赖：P09-04, P09-05 |

### P10 — 纸面模拟与独立风控

**目标：**实现合规、不可伪造的纸面账户账本和单笔2%/峰值回撤20%硬限制。
**阶段验收：**权益/现金/FX/止损/幂等/否决的边界测试全部通过；无任何真实交易接口。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P10-01`](https://github.com/OYLPY/stock-monitor/issues/64) | **模拟账户及不可变资金流水**：创建账户初始化明确标记 1,000,000 JPY；账本事件只追加；实现持仓、现金、费用、权益快照与来源。 | src/features/paper/ledger、迁移/测试 | 初始账户不含虚构成交；重放账本一致；拒绝负现金与无依据流水；依赖：P05-01, P03-01 |
| [`P10-02`](https://github.com/OYLPY/stock-monitor/issues/65) | **纸面计划审批与确定性风险官**：建立研究候选→计划→已审批/否决状态；计算当前可核验权益、单笔最差计划损失、可买股数、资金与最小交易单位；拒绝失效数据。 | src/features/risk/checker、风控记录 | 超过权益2%立即拒绝；权益不可核验时拒绝；AI不能覆盖否决；依赖：P10-01, P03-03 |
| [`P10-03`](https://github.com/OYLPY/stock-monitor/issues/66) | **20%峰值回撤阻断及跨币种权益**：按历史峰值计算回撤，权益按可核查 FX 折算 JPY；净值无法估值时禁止新头寸；支持单日缺失数据场景。 | src/features/risk/drawdown、测试 | 恰好20%及以上阻断；历史峰值不会丢失；FX过期不生成可用权益；依赖：P10-01, P10-02 |
| [`P10-04`](https://github.com/OYLPY/stock-monitor/issues/67) | **模拟成交引擎、手续费与滑点**：只根据可核验行情、预定义撮合规则、订单状态与时间戳创建模拟成交；处理部分成交、跳空、拒绝成交、重复回放。 | src/features/paper/fill-engine、SQLite 迁移、回归集 | 无可核查价格不成交；止损已触及时拒绝新入场；幂等不双扣费；模拟而非真实broker API；依赖：P10-02, P10-03, P09-02 |
| [`P10-05`](https://github.com/OYLPY/stock-monitor/issues/68) | **账本审计、指标及恢复**：账本重放权益曲线、最大回撤和交易编号；完成断电恢复、备份恢复、错误记录及和 UI 的审计契约。 | src/features/paper/audit、恢复测试 | 订单/成交/现金守恒；恢复前后同结果；无账本时显示未建立；依赖：P10-04, P05-05 |

### P11 — 自动任务、监测与通知

**目标：**在本机可靠执行四类任务，严格按日美常规交易窗口做盘中扫描，且只通知真正新信息。
**阶段验收：**交易日历、重试恢复、事件去重与重大通知均在故障注入测试中通过。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P11-01`](https://github.com/OYLPY/stock-monitor/issues/69) | **Worker 任务队列与调度器**：实现独立本地进程、计划任务时区、任务锁、运行日志、恢复/取消、非重入及超时保护；保留本机运行边界。 | worker/scheduler、持久化队列 | 浏览器关闭不影响运行中的 Worker；重启补偿，不重复任务副作用；依赖：P04-04, P05-01 |
| [`P11-02`](https://github.com/OYLPY/stock-monitor/issues/70) | **美日市场时段扫描与假日异常**：基于 P07 市场日历只在至少一个常规交易时段扫描；日本午休、DST、节假日、特别收市正确处理；快照陈旧不得触发信号。 | worker/market-watch、日历测试 | 周末/双休无扫描；美东9:30–16:00/JST转换正确；午休不监控；依赖：P11-01, P07-01 |
| [`P11-03`](https://github.com/OYLPY/stock-monitor/issues/71) | **重大新事件规则、去重与告警**：多来源确认与置信级、先后比较、事件指纹、最多三项、只有独立新重大事项才通知；数据不可用不得推断无异常。 | src/features/alerts、通知历史 | 同事件多源仅一次提醒；旧信息不会反复告警；无变化不通知；依赖：P07-05, P08-03, P11-02 |
| [`P11-04`](https://github.com/OYLPY/stock-monitor/issues/72) | **晨报、日审计和周审计任务编排**：在本机 Worker 调度晨报、每日策略研究/纸面审计与周度审计；结果持久化并附数据限制。盘中扫描和异常提醒仍由 P11-03 单独负责。 | worker/jobs、任务参数与失败报告 | 行情缺失时仍归档 NOT_VERIFIED 且无候选；休市可做研究但不冒充盘中；失败状态可审查；依赖：P08-04, P11-01 |
| [`P11-05`](https://github.com/OYLPY/stock-monitor/issues/73) | **本地通知渠道与持续运行指南**：实现系统支持的本地通知/页面通知及可控静默，明确电脑关闭和系统睡眠限制；生成 macOS launchd/Windows Task Scheduler 文档或脚本。 | 通知适配器、运维说明 | 仅重大新信息触达；无授权时不启用系统通知；不声称设备关机后继续运行；依赖：P11-03, P11-04 |

### P12 — 完整测试与安全质量审计

**目标：**用可重复的自动化证据证明业务规则与本地运行可靠，发现阻断缺陷并修复。
**阶段验收：**typecheck/lint/build/单测/集成/E2E 完整通过，阻断级问题为零，外部阻断明确披露。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P12-01`](https://github.com/OYLPY/stock-monitor/issues/74) | **单元测试覆盖风险、时间、价量与计算**：针对 TSE 午休、NYSE DST/假日、JPY精度、2%风险、20%回撤、ATR、缺数据和事件指纹进行边界与性质测试。 | tests/unit、覆盖报告 | 关键不变量覆盖可追溯且通过；不降低测试阈值掩盖失败；依赖：P07-01, P09-01, P10-03 |
| [`P12-02`](https://github.com/OYLPY/stock-monitor/issues/75) | **集成测试覆盖数据库与各数据源故障**：测试迁移、事务、幂等入账、双写争用、API校验、数据源断开/限流和过时行情拒绝。 | tests/integration、DB Fixture | 重复执行不双成交/双通知；掉线有状态并可恢复；无泄露凭据；依赖：P07-05, P10-05, P11-03 |
| [`P12-03`](https://github.com/OYLPY/stock-monitor/issues/76) | **Playwright 完整 E2E 研究与模拟计划**：UI 覆盖无需登录的本地初始化、晨报、证据查看、策略草案、风控拒绝、账本/设置/备份完整路径；使用显著 Fixture 模式。 | tests/e2e、截图与失败记录 | 重要按钮都有效；无行情时不出现伪实时/成交；导航和错误态可操作；依赖：P06-06, P10-05, P11-04 |
| [`P12-04`](https://github.com/OYLPY/stock-monitor/issues/77) | **回测与研究结果可重复性审计**：检查样本外与 2020/2022 压力流程、成本/FX敏感性、数据溯源、未来函数防护及五维评分门禁。 | tests/quant-audit、验算数据 | 已声明的实测结果均可复算；无数据明确 NOT_VERIFIED，不上报虚假战绩；依赖：P09-06 |
| [`P12-05`](https://github.com/OYLPY/stock-monitor/issues/78) | **安全与故障恢复演练**：检查无真实订单路由、无凭据泄漏、最小权限、提示注入、请求滥用、数据库损坏恢复、Codex额度/认证中断。 | docs/testing/SECURITY_AUDIT.md、故障恢复证据 | 不可突破沙盒/权限；外部不可信文本不改变规则；异常下安全暂停；依赖：P00-05, P05-05, P08-05, P11-05 |
| [`P12-06`](https://github.com/OYLPY/stock-monitor/issues/79) | **最终系统质量门禁与缺陷清零**：执行冻结依赖安装、lint、typecheck、unit、integration、E2E、build、完整离线演示；出具问题分级和证据路径。 | docs/testing/RELEASE_GATE.md、缺陷登记 | 阻断级缺陷0；失败不宣布完成；已知外部限制逐项说明；依赖：P12-01, P12-02, P12-03, P12-04, P12-05 |

### P13 — 本地发布与交付

**目标：**交付可复现的离线优先本地应用和完整可审计文档。
**阶段验收：**新环境按文档安装运行成功；部署不含外部真实交易和任何虚假测试结论。

| ID | 任务与实施重点 | 交付物 | 验收/依赖 |
|---|---|---|---|
| [`P13-01`](https://github.com/OYLPY/stock-monitor/issues/80) | **安装、配置与本地运行手册**：编写 Node/pnpm/Codex SDK 的系统要求、环境变量、可选行情 API、Windows/macOS 启动、调度/休眠限制。 | README.md、docs/operations/INSTALL.md、.env.example | 干净环境按步骤部署；密钥不进入浏览器或Git；缺源时可离线演示；依赖：P12-06 |
| [`P13-02`](https://github.com/OYLPY/stock-monitor/issues/81) | **产品使用手册与研究风险说明**：编写行情来源等级、延时标签、六角色报告、回测与纸面记录、2%/20%限制、异常恢复、任何回测均非保证。 | docs/USER_GUIDE.md、FAQ、风险说明 | 每个主页面有使用步骤；不误导为自动真实交易工具；依赖：P12-03 |
| [`P13-03`](https://github.com/OYLPY/stock-monitor/issues/82) | **本地发布脚本、备份及重装验收**：实现本地生产 build/start、Worker 生命周期、首次迁移、数据库备份与恢复、版本升级；运行干净环境验收。 | scripts/release、smoke/restore scripts | 重装/重启数据完整，任务不重复；无云端发布/自动合并；日志可核查；依赖：P13-01, P05-05 |
| [`P13-04`](https://github.com/OYLPY/stock-monitor/issues/83) | **最终交付报告与未完成事项登记**：核对需求-设计-测试矩阵、所有 Issue 验收、完整演示、测试摘要、无法接入的第三方源及后续路线；标记 READY 或 PARTIAL_DELIVERY。 | docs/RELEASE_REPORT.md、已知限制清单 | 仅通过事实验收才 READY；阻断依赖注明责任与下一步；不编造收益或成交；依赖：P13-02, P13-03 |

## 统一验收与发布判定

- 代码：Issue 跟踪工作项；直接在 `main` 开发。TypeScript strict、Lint、Vitest、集成测试、Playwright、构建与独立质量门禁须有真实运行日志；全部通过后提交并 push，确认 main CI 成功再关闭 Issue。
- 金融：开闭市/DST/午休、数据时效和去重；2%/20%极限、FX、滑点、现金守恒、不可验证报价拒绝成交；没有真实下单能力。
- 研究：真实行情足够才允许回测实绩；2020/2022 和样本外不能完成时明确写 NOT_VERIFIED。18/25 仅用于验证候选而非自动交易批准。
- 可靠性：任务幂等、单实例、数据库备份恢复、上下文压缩交接、中断重启；无凭据/联网错误安全降级。
- 质量：真实完整验收才 READY；任何关键外部阻断或未通过测试必须 PARTIAL_DELIVERY。不得虚构完成度。

## 如何从 Issue 继续

先看阶段 Issue 的前置门禁，再按原子任务 ID 选择依赖已完成项。每次只执行一个 Issue，直接在 `main` 完成设计、编码和验证；提交说明包含工作项 ID，push 后核对自动检查与 Issue 验收证据。变更需求或安全边界先记录 ADR 并调整相关 Issue 与测试追踪矩阵。

## GitHub Issues 导航

- [全部 69 项工作任务与 14 个阶段门禁](ISSUE_INDEX.md)；GitHub Issue 状态比文档复选框更新更及时。

## 相关文档

- [`AGENTS.md`](../AGENTS.md)：最高层工程操作与安全规则、NVIDIA 六字段短上下文交接。
- [`docs/CONTEXT_ENGINEERING.md`](CONTEXT_ENGINEERING.md)：EoCC/SAC 的工程解读与重启准确性验收。
- [`docs/backlog/part-00-06.json`](backlog/part-00-06.json) 和 [`part-07-13.json`](backlog/part-07-13.json)：任务及依赖机器可读基线。
- [NVIDIA 原论文 (2026)](https://arxiv.org/abs/2611.05306)。
