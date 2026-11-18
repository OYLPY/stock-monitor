# GitHub Issue 索引

> 原子任务与阶段门禁的单一导航入口。关闭 Issue 前须有真实验证记录和已 push 到 `main` 的提交 SHA。

**计划范围** 14 个阶段、69 个原子任务；跨阶段 PMO 工作项单独列出，不计入阶段任务数。

| 阶段 | 父 Issue | 原子任务 |
|---|---|---|
| **P00 — 工程创建与自主执行基础** | [#1](https://github.com/OYLPY/stock-monitor/issues/1) | 5 项 |
| **P01 — 需求设计** | [#2](https://github.com/OYLPY/stock-monitor/issues/2) | 4 项 |
| **P02 — 系统基本设计** | [#3](https://github.com/OYLPY/stock-monitor/issues/3) | 4 项 |
| **P03 — 详细设计** | [#4](https://github.com/OYLPY/stock-monitor/issues/4) | 5 项 |
| **P04 — 技术可行性验证** | [#5](https://github.com/OYLPY/stock-monitor/issues/5) | 4 项 |
| **P05 — 数据与工程基础实现** | [#6](https://github.com/OYLPY/stock-monitor/issues/6) | 5 项 |
| **P06 — React UI 与体验实现** | [#7](https://github.com/OYLPY/stock-monitor/issues/7) | 6 项 |
| **P07 — 行情与公开信息采集实现** | [#8](https://github.com/OYLPY/stock-monitor/issues/8) | 5 项 |
| **P08 — Codex 六角色研究执行** | [#9](https://github.com/OYLPY/stock-monitor/issues/9) | 5 项 |
| **P09 — 指标、回测与量化验证** | [#10](https://github.com/OYLPY/stock-monitor/issues/10) | 6 项 |
| **P10 — 纸面模拟与独立风控** | [#11](https://github.com/OYLPY/stock-monitor/issues/11) | 5 项 |
| **P11 — 自动任务、监测与通知** | [#12](https://github.com/OYLPY/stock-monitor/issues/12) | 5 项 |
| **P12 — 完整测试与安全质量审计** | [#13](https://github.com/OYLPY/stock-monitor/issues/13) | 6 项 |
| **P13 — 本地发布与交付** | [#14](https://github.com/OYLPY/stock-monitor/issues/14) | 4 项 |

## 跨阶段 PMO 工作项

- [x] [PMO-01 — 设计文档编号、索引与标签治理](https://github.com/OYLPY/stock-monitor/issues/88) · 入口：[文档索引](INDEX.md)

## 全部任务

### [P00 工程创建与自主执行基础](https://github.com/OYLPY/stock-monitor/issues/1)

- [x] [P00-01 — 创建 Next.js 应用与可复现环境](https://github.com/OYLPY/stock-monitor/issues/15) · 依赖：无
- [x] [P00-02 — 建立质量、安全和仓库协作规范](https://github.com/OYLPY/stock-monitor/issues/16) · 依赖：P00-01
- [x] [P00-03 — 实现 Codex 自动任务执行器](https://github.com/OYLPY/stock-monitor/issues/17) · 依赖：P00-02
- [x] [P00-04 — NVIDIA 短上下文压缩与交接能力](https://github.com/OYLPY/stock-monitor/issues/18) · 依赖：P00-03
- [x] [P00-05 — P00 故障恢复与阶段验收](https://github.com/OYLPY/stock-monitor/issues/19) · 依赖：P00-03, P00-04

#### P00-02 需求—设计—验证追踪

| 要求 | 设计/实现入口 | 验证入口 |
|---|---|---|
| UI 开发按 Modern Web Guidance 实施 | `AGENTS.md`、`docs/design/UI_DESIGN.md`、`.agents/skills/modern-web-guidance/` | 后续 UI Issue 按功能检索并验证；本任务检查文档与安装锁文件 |
| 质量命令可在 PR 自动执行 | `package.json`、`.github/workflows/quality.yml` | `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` |
| scaffold 不依赖凭据或行情数据 | `README.md`、`.env.example`、`src/app/page.tsx` | `src/app/page.test.tsx` 静态渲染冒烟测试 |
| 本地密钥不进入版本控制 | `.gitignore` | `git check-ignore -v .env .env.local` |

#### P00-03 需求—设计—验证追踪

| 要求 | 设计/实现入口 | 验证入口 |
|---|---|---|
| 任务来自受控 backlog，依赖未完成时不得启动 | `scripts/autopilot.ts`、`docs/backlog/*.json`、`harness/tasks.json` | `scripts/autopilot.test.ts`；`pnpm autopilot --task <id>` |
| 单实例、原子状态、崩溃恢复和 DONE 幂等 | `scripts/autopilot.ts`、`harness/tasks.schema.json` | `scripts/autopilot.test.ts`；P00-05 故障恢复验收 |
| 无凭据阻断、超时与最多 3 次修复 | `scripts/autopilot.ts`、`harness/logs/` | 隔离 CODEX_HOME 无凭据执行；修复上限单测；日志中的实际退出码 |
| 命令安全、离线行情边界和执行记录 | `scripts/autopilot.ts`、`docs/CONTEXT_ENGINEERING.md` | sandbox 网络配置；离线/无数据用例；`harness/logs/<task>-<run-id>.json` |

#### P00-04 需求—设计—验证追踪

| 要求 | 设计/实现入口 | 验证入口 |
|---|---|---|
| 只加载安全规则、当前状态、当前任务及直接依赖交接 | `scripts/context.ts`、`scripts/autopilot.ts` | `scripts/context.test.ts`：包含相关 handoff，排除无关交接和原始日志 |
| 六字段短交接与跨会话恢复 | `harness/handoffs/TEMPLATE.md`、`harness/handoffs/P00-04.md` | 模板字段检查；上下文重建测试；恢复后重新读取文件并执行质量检查 |
| 保留原始验收、安全边界和日志证据；截断内容不得推断 | `docs/CONTEXT_ENGINEERING.md`、`scripts/context.ts` | `scripts/context.test.ts` 检查安全规则与重验提示，且不加载日志内容 |
| 记录上下文来源和 Codex 每轮 token 用量；不臆造窗口阈值 | `scripts/autopilot.ts`、`harness/logs/<task>-<run-id>.json` | `scripts/autopilot.test.ts` usage 事件测试；无凭据运行在 SDK/行情访问前阻断 |

#### P00-05 需求—设计—验证追踪

| 要求 | 设计/实现入口 | 验证入口 |
|---|---|---|
| 进程中断和陈旧锁可恢复；并发执行仍受单实例锁阻止 | `scripts/autopilot.ts`、`harness/tasks.json` | `scripts/autopilot.test.ts`：中断 RUNNING 状态、退出锁 owner 后恢复、并发锁拒绝 |
| DONE 幂等；损坏状态或失败不能变成 DONE | `scripts/autopilot.ts`、`harness/tasks.schema.json` | `scripts/autopilot.test.ts`：DONE 跳过且不改状态、损坏 JSON 原样保留、失败门禁 |
| 超时、外部模型/授权阻断、命令退出码与耗时可审计 | `scripts/autopilot.ts`、`harness/logs/` | `scripts/autopilot.test.ts`：超时、BLOCKED_EXTERNAL、离线事件 Fixture 的退出码/耗时记录 |
| 离线样本不得冒充真实推理或行情数据 | `scripts/autopilot.test.ts`、`docs/testing/P00_RECOVERY_REPORT.md` | `OFFLINE_FIXTURE_ONLY` 事件测试；报告区分模拟 Fixture 与真实 runner 阻断记录 |
| P00 全阶段验收有可追溯证据 | `docs/testing/P00_RECOVERY_REPORT.md`、`harness/handoffs/P00-05.md` | P00 子 Issue 状态、main 提交和 Quality CI 运行记录 |

### [P01 需求设计](https://github.com/OYLPY/stock-monitor/issues/2)

- [x] [P01-01 — PRD 与用户场景/范围](https://github.com/OYLPY/stock-monitor/issues/20) · 依赖：P00-02
- [x] [P01-02 — 晨报、异常监控与 AI 研究功能需求](https://github.com/OYLPY/stock-monitor/issues/21) · 依赖：P01-01
- [x] [P01-03 — 纸面交易、回测、风控需求](https://github.com/OYLPY/stock-monitor/issues/22) · 依赖：P01-01
- [x] [P01-04 — 非功能需求与验收追踪矩阵](https://github.com/OYLPY/stock-monitor/issues/23) · 依赖：P01-02, P01-03

#### P01-02 需求—设计—验证追踪

| 要求 | 设计入口 | 验收入口 |
|---|---|---|
| 交易日历、DST/假日/午休、盘中监测窗口和日历失败关闭 | docs/requirements/FR_RESEARCH.md：FR-Research-001/002；PRD BR-06/07 | AC-RES-001–006：常规时段、休市、午休、DST、提前收盘、日历不可用 |
| 重大性、新事件、迟到发现、去重和每轮最多 3 项 | docs/requirements/FR_RESEARCH.md：FR-Research-003/004/005 | AC-RES-007–012：无新事件、旧/重复事件、过期数据、缺少来源、超额事件 |
| 晨报、经济日历、研究候选、风控与账本字段 | docs/requirements/FR_RESEARCH.md：FR-Research-007/008/009 | AC-RES-013–016：未完成交易日、经济日历、空策略、风控输入不足 |
| 来源时间戳、验证等级、Fixture 隔离及降级状态 | docs/requirements/FR_RESEARCH.md：FR-Research-006/010/011 | AC-RES-009–017；P07/P08/P12 实施后进行运行时验证 |
| 用例与产品需求可追踪至明细 FR | docs/requirements/REQUIREMENTS_INDEX.md、docs/requirements/USE_CASES.md | RQ-003–012、RQ-023、RQ-028、RQ-030 映射到 FR 和 AC-RES-001–023 |

#### P01-03 需求—设计—验证追踪

| 要求 | 设计入口 | 验收入口 |
|---|---|---|
| 账户初始化、可核验权益、现金与结算 | docs/requirements/FR_TRADE.md：FR-Trade-004/005/008/010 | AC-TRD-001/002/006/011/012/014/015；P03/P10/P12 运行时验证 |
| 计划版本、本地批准、证券范围与确定性风险 | docs/requirements/FR_TRADE.md：FR-Trade-001/002/003/006/007 | AC-TRD-003–009；P09/P10/P12 运行时验证 |
| 模拟订单、成交与只追加账本 | docs/requirements/FR_TRADE.md：FR-Trade-009/010 | AC-TRD-013/014；P10/P12 运行时验证 |
| 回测可复算、防未来函数、五维评分和 Fixture 降级 | docs/requirements/FR_TRADE.md：FR-Trade-008/011/012/013 | AC-TRD-006/010/016–019；P09/P12 运行时验证 |
| RQ—用例—明细契约完整映射 | docs/requirements/REQUIREMENTS_INDEX.md、USE_CASES.md | RQ-002、RQ-013–022 → UC-04/07/08 → FR-Trade → AC-TRD-001–019 |

#### P01-04 非功能需求—完整追踪

| 要求 | 设计入口 | 验收入口 |
|---|---|---|
| 性能、离线/外部降级、重试、Worker 恢复 | docs/requirements/NFR.md：NFR-002–005 | AC-NFR-003–009；P04/P11/P12-02/P12-06 运行时验证 |
| 凭据保护、本地边界、审计和备份 | docs/requirements/NFR.md：NFR-001/006–008 | AC-NFR-001/002/010–012/022；P02/P05/P12-05 运行时验证 |
| 数据质量、Fixture 隔离、语言和无障碍 | docs/requirements/NFR.md：NFR-009–012 | AC-NFR-013–020；P06/P07/P08/P12-03/P12-04 运行时验证 |
| 上下文交接、证据恢复和不可信外部文本边界 | docs/requirements/NFR.md：NFR-008/013 | AC-NFR-021/022；P08-05/P12-05 回归 |
| 全部产品 RQ、功能 FR 和 NFR 均可追到设计与测试阶段 | docs/requirements/TRACEABILITY.md | RQ-001–031、FR-Research-001–012、FR-Trade-001–013、NFR-001–013 → 对应 AC；仅文档定义，P12 尚未运行 |

### [P02 系统基本设计](https://github.com/OYLPY/stock-monitor/issues/3)

- [x] [P02-01 — 系统上下文、容器及模块分层](https://github.com/OYLPY/stock-monitor/issues/24) · 交付：[ARCHITECTURE.md](design/ARCHITECTURE.md) · 覆盖：RQ-001、RQ-018、RQ-023–025、NFR-001/003/005/008 · 依赖：P01-04
- [x] [P02-02 — 市场数据与证据溯源架构](https://github.com/OYLPY/stock-monitor/issues/25) · 交付：[DATA_PROVENANCE.md](design/DATA_PROVENANCE.md)、[来源核验记录](research/P02-02-DATA-SOURCE-FINDINGS.md) · 覆盖：RQ-010/011/028、NFR-003/009/010、FR-Research-006/010/011、FR-Trade-008 · 依赖：P02-01
- [x] [P02-03 — AI 六角色编排与确定性风控边界](https://github.com/OYLPY/stock-monitor/issues/26) · 交付：[AI_WORKFLOW.md](design/AI_WORKFLOW.md)（串行角色 I/O、权限矩阵与否决/失败门禁） · 覆盖：RQ-009/019/020、NFR-003、FR-Research-008/010/011、FR-Trade-001/002/013、AC-RES-020、AC-TRD-004 · 依赖：P02-01
- [x] [P02-04 — ADR 与安全/运行故障设计](https://github.com/OYLPY/stock-monitor/issues/27) · 交付：[ADR-0001–0003](decisions/)、[THREAT_MODEL.md](design/THREAT_MODEL.md)、[FAILURE_MODES.md](design/FAILURE_MODES.md) · 覆盖：RQ-001/018/023–026/031、NFR-001/003–008 · 依赖：P02-01, P02-02, P02-03

### [P03 详细设计](https://github.com/OYLPY/stock-monitor/issues/4)

- [x] [P03-01 — SQLite Schema、迁移与账本不变量](https://github.com/OYLPY/stock-monitor/issues/28) · 交付：[DB_SCHEMA.md](design/DB_SCHEMA.md)（实体边界、迁移草案、ER 图） · 覆盖：FR-Research-006/010/011、FR-Trade-004/005/010、NFR-005/006/007 · 依赖：P02-01, P01-03
- [x] [P03-02 — API/DTO 与状态机契约](https://github.com/OYLPY/stock-monitor/issues/29) · 交付：[API_CONTRACTS.md](design/API_CONTRACTS.md)（Route Handler、Zod DTO、错误码、分页、回测/报告/任务/计划/纸面订单状态图） · 覆盖：RQ-001/018/019/020/025/031、FR-Research-006/010/011、FR-Trade-001/002/009、NFR-001/008 · 依赖：P02-01, P03-01
- [x] [P03-03 — 风险算法与订单仓位计算](https://github.com/OYLPY/stock-monitor/issues/30) · 交付：[RISK_ENGINE.md](design/RISK_ENGINE.md)（权益/JPY 与 USD FX/风险单位/费用滑点跳空/20%回撤/集中度/透支决策表） · 覆盖：RQ-002/016–019/022、FR-Trade-003–010、NFR-006/009/010 · 依赖：P03-01
- [x] [P03-04 — 指标/回测与评分详细设计](https://github.com/OYLPY/stock-monitor/issues/31) · 交付：[BACKTEST_ENGINE.md](design/BACKTEST_ENGINE.md) · 依赖：P03-01, P01-03
- [x] [P03-05 — 任务调度、事件指纹、通知与上下文状态机](https://github.com/OYLPY/stock-monitor/issues/32) · 交付：[SCHEDULER.md](design/SCHEDULER.md)、[WORKFLOW_STATE.md](design/WORKFLOW_STATE.md) · 覆盖：RQ-003/005/006/023/024/029、FR-Research-001–006、UC-03/09、NFR-004/005/013 · 依赖：P02-04, P03-02

### [P04 技术可行性验证](https://github.com/OYLPY/stock-monitor/issues/5)

- [x] [P04-01 — Codex SDK 本地授权与流式调用 PoC](https://github.com/OYLPY/stock-monitor/issues/33) · 交付：[p04-01-codex-sdk-findings.md](research/p04-01-codex-sdk-findings.md)、[PoC](../poc/codex/README.md) · 依赖：P03-02
- [x] [P04-02 — SQLite/Drizzle 精度与迁移 PoC](https://github.com/OYLPY/stock-monitor/issues/34) · 交付：[DOC-0035](research/p04-02-sqlite-drizzle-findings.md)、[PoC](../poc/sqlite/README.md) · 依赖：P03-01
- [x] [P04-03 — 美日历史/公告数据适配器 PoC](https://github.com/OYLPY/stock-monitor/issues/35) · 交付：[DOC-0036](research/data-sources.md)、[离线 PoC](../poc/market-data/README.md) · 依赖：P02-02
- [x] [P04-04 — 后台 Worker、关闭浏览器及重启恢复 PoC](https://github.com/OYLPY/stock-monitor/issues/36) · 交付：[DOC-0037](research/p04-04-worker-runtime-findings.md)、[PoC 与运行手册](../poc/worker/README.md)、[六字段交接](../harness/handoffs/P04-04.md) · 依赖：P03-05

### [P05 数据与工程基础实现](https://github.com/OYLPY/stock-monitor/issues/6)

- [x] [P05-01 — 建立数据库、迁移及仓储层](https://github.com/OYLPY/stock-monitor/issues/37) · 依赖：P04-02
- [x] [P05-02 — 统一时间、金额、货币与市场标识](https://github.com/OYLPY/stock-monitor/issues/38) · 依赖：P03-02
- [x] [P05-03 — 输入 Schema、API 基础设施与安全设置](https://github.com/OYLPY/stock-monitor/issues/39) · 交付：[API_CONTRACTS.md](design/API_CONTRACTS.md)、`src/lib/api`、`src/lib/security`、`.env.example` · 覆盖：RQ-001、RQ-025 · 依赖：P05-01, P05-02
- [x] [P05-04 — 事件与来源仓储及审计历史](https://github.com/OYLPY/stock-monitor/issues/40) · 交付：[DB_SCHEMA.md](design/DB_SCHEMA.md)、[DATA_PROVENANCE.md](design/DATA_PROVENANCE.md)、`src/features/evidence`、[六字段交接](../harness/handoffs/P05-04.md) · 覆盖：RQ-010/011、FR-Research-006、NFR-007 · 依赖：P05-01, P05-03
- [x] [P05-05 — 备份、恢复和数据库完整性验证](https://github.com/OYLPY/stock-monitor/issues/41) · 交付：[DOC-0039](operations/backup.md)、`src/db/backup.ts`、`scripts/backup.ts`、`scripts/restore.ts`、[六字段交接](../harness/handoffs/P05-05.md) · 覆盖：RQ-026、NFR-007、AC-NFR-011 · 依赖：P05-01, P05-04

### [P06 React UI 与体验实现](https://github.com/OYLPY/stock-monitor/issues/7)

- [x] [P06-01 — 设计系统和应用壳层](https://github.com/OYLPY/stock-monitor/issues/42) · 交付：[DOC-0017](design/UI_DESIGN.md)、`components.json`、`src/components/ui`、`src/components/layout`、[六字段交接](../harness/handoffs/P06-01.md) · 覆盖：RQ-027、NFR-011/012、AC-NFR-016–020 · 依赖：P05-03
- [x] [P06-02 — 美日市场 Dashboard 与行情图表](https://github.com/OYLPY/stock-monitor/issues/43) · 交付：`src/app/markets/page.tsx`、`src/components/market`、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/P06-02.md) · 覆盖：RQ-010/011/027/028、FR-Research-006/010/011、NFR-011/012 · 依赖：P06-01, P05-04
- [x] [P06-03 — 异常监测与事件证据中心](https://github.com/OYLPY/stock-monitor/issues/44) · 交付：`src/app/events/page.tsx`、`src/components/events`、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/P06-03.md) · 覆盖：FR-Research-003/004/005/006/010/011 · 依赖：P06-01, P05-04
- [x] [P06-04 — 晨报及六角色策略研究工作台](https://github.com/OYLPY/stock-monitor/issues/45) · 交付：`src/app/reports`、`src/components/reports`、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/P06-04.md) · 覆盖：RQ-004/007/008/009、FR-Research-007/008/009 · 依赖：P06-01, P05-04
- [x] [P06-05 — 回测与纸面模拟账户界面](https://github.com/OYLPY/stock-monitor/issues/46) · 交付：`src/app/backtests`、`src/components/backtests`、`src/db/paper-account-repository`、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/P06-05.md) · 覆盖：RQ-013–022、FR-Trade-004/008–013、NFR-011/012 · 依赖：P06-01, P05-01
- [x] [P06-06 — 设置、任务日志、通知及 E2E 页面验收](https://github.com/OYLPY/stock-monitor/issues/47) · 交付：[DOC-0009](design/API_CONTRACTS.md)、[DOC-0017](design/UI_DESIGN.md)、[DOC-0039](operations/backup.md)、`src/app/settings`、`src/app/tasks`、`src/app/api/v1/backup`、[六字段交接](../harness/handoffs/P06-06.md) · 覆盖：RQ-026、NFR-007/008/012 · 依赖：P06-02, P06-03, P06-04, P06-05

### [P07 行情与公开信息采集实现](https://github.com/OYLPY/stock-monitor/issues/8)

- [x] [P07-01 — NYSE/Nasdaq/JPX 交易日历与时段判定](https://github.com/OYLPY/stock-monitor/issues/48) · 交付：[版本化日历实现](../src/features/market-calendar/market-calendar.ts)、[DOC-0032 调度契约](design/SCHEDULER.md)、[六字段交接](../harness/handoffs/P07-01.md) · 覆盖：RQ-003/005、FR-Research-001/002 · 依赖：P05-02, P04-03
- [ ] [P07-02 — 美股行情/历史数据适配器](https://github.com/OYLPY/stock-monitor/issues/49) · 状态：`BLOCKED_EXTERNAL`（Alpha Vantage 免费仅最近 100 条、研究用途许可未确认；Twelve Data Basic 为非显示用途；Alpaca 历史始于 2016；Tiingo Starter 虽有 30 年以上价格历史但禁止持久保存行情和派生产品；无用户授权凭据；见 [DOC-0036](research/data-sources.md)） · 交接：[六字段记录](../harness/handoffs/P07-02.md) · 依赖：P07-01, P05-04
- [ ] [P07-03 — 日股行情/历史数据适配器](https://github.com/OYLPY/stock-monitor/issues/50) · 状态：`BLOCKED_EXTERNAL`（Free 仅 2 年且延迟 12 周；需注册，付费计划仍未覆盖数十年；见 [DOC-0036](research/data-sources.md)） · 交接：[六字段记录](../harness/handoffs/P07-03.md) · 依赖：P07-01, P05-04
- [x] [P07-04 — 公司公告、财报与官方宏观采集](https://github.com/OYLPY/stock-monitor/issues/51) · 实现提交 [2d3b769](https://github.com/OYLPY/stock-monitor/commit/2d3b769687285b663b6265f199b88ddf1cef8c7c) / [Quality CI 43885925362](https://github.com/OYLPY/stock-monitor/actions/runs/43885925362) success；验收交接 [cb11b47](https://github.com/OYLPY/stock-monitor/commit/cb11b4748ddeb239d784d3c18dff218f4ba18664) / [Quality CI 43887584327](https://github.com/OYLPY/stock-monitor/actions/runs/43887584327) success；#51 已关闭 · 线上来源可用性仍 `NOT_VERIFIED`，EDINET/BEA 缺 key、TDnet 付费未授权、issuer IR 为手工引用 · 交接：[六字段记录](../harness/handoffs/P07-04.md) · 依赖：P07-01, P05-04
- [ ] [P07-05 — 事件归一化、新旧判断与数据质量门禁](https://github.com/OYLPY/stock-monitor/issues/52) · 依赖：P07-02, P07-03, P07-04

### [P08 Codex 六角色研究执行](https://github.com/OYLPY/stock-monitor/issues/9)

- [x] [P08-01 — Codex SDK 服务封装与任务隔离](https://github.com/OYLPY/stock-monitor/issues/53) · 交付：`src/features/ai/codex-adapter`、[六字段交接](../harness/handoffs/P08-01.md) · 实现提交：[6f98e815](https://github.com/OYLPY/stock-monitor/commit/6f98e81585dca6aa37997739d18541d36e947a68) · Quality CI：[43873045326](https://github.com/OYLPY/stock-monitor/actions/runs/43873045326) success · 依赖：P04-01, P05-03
- [ ] [P08-02 — 六角色结构化研究工作流](https://github.com/OYLPY/stock-monitor/issues/54) · 依赖：P08-01, P07-05
- [ ] [P08-03 — 研究证据引用与反幻觉校验](https://github.com/OYLPY/stock-monitor/issues/55) · 依赖：P08-02, P07-05
- [ ] [P08-04 — 晨报/异常报告/每日与每周审计生成](https://github.com/OYLPY/stock-monitor/issues/56) · 依赖：P08-02, P08-03
- [ ] [P08-05 — AI研究回归评估和上下文交接](https://github.com/OYLPY/stock-monitor/issues/57) · 依赖：P08-03, P00-04

### [P09 指标、回测与量化验证](https://github.com/OYLPY/stock-monitor/issues/10)

- [ ] [P09-01 — OHLCV 归一化与指标库](https://github.com/OYLPY/stock-monitor/issues/58) · 依赖：P05-02（供应商接入 P07-02/P07-03 不阻塞；按 DOC-0011 点时调整契约）。
- [ ] [P09-02 — 无未来函数的回测撮合引擎](https://github.com/OYLPY/stock-monitor/issues/59) · 依赖：P09-01, P03-04
- [ ] [P09-03 — 三类初始策略与参数边界](https://github.com/OYLPY/stock-monitor/issues/60) · 依赖：P09-01, P09-02
- [ ] [P09-04 — 样本内/样本外与 Walk-forward 实验](https://github.com/OYLPY/stock-monitor/issues/61) · 依赖：P09-02, P09-03
- [ ] [P09-05 — 2020/2022 压力与费用/汇率敏感性](https://github.com/OYLPY/stock-monitor/issues/62) · 依赖：P09-04
- [ ] [P09-06 — 五维评分与 18/25 验证候选门禁](https://github.com/OYLPY/stock-monitor/issues/63) · 依赖：P09-04, P09-05

### [P10 纸面模拟与独立风控](https://github.com/OYLPY/stock-monitor/issues/11)

- [x] [P10-01 — 模拟账户及不可变资金流水](https://github.com/OYLPY/stock-monitor/issues/64) · 交付：[纸面账本](../src/features/paper/ledger.ts)、[六字段交接](../harness/handoffs/P10-01.md) · 实现提交 f3d87fc / [Quality CI 44012299880](https://github.com/OYLPY/stock-monitor/actions/runs/44012299880)；迁移兼容修复 fa7331c / [Quality CI 44016190625](https://github.com/OYLPY/stock-monitor/actions/runs/44016190625)；备份测试修正 8a077c9 / [Quality CI 44017397513](https://github.com/OYLPY/stock-monitor/actions/runs/44017397513) · 依赖：P05-01, P03-01
- [x] [P10-02 — 纸面计划审批与确定性风险官](https://github.com/OYLPY/stock-monitor/issues/65) · 交付：[风险检查器](../src/features/risk/checker.ts)、[六字段交接](../harness/handoffs/P10-02.md) · 提交 [`5bb5141`](https://github.com/OYLPY/stock-monitor/commit/5bb5141d441c6f256250375f5daf4a25282b40c8) / [Quality CI 44025841254](https://github.com/OYLPY/stock-monitor/actions/runs/44025841254) success · 依赖：P10-01, P03-03
- [x] [P10-03 — 20%峰值回撤阻断及跨币种权益](https://github.com/OYLPY/stock-monitor/issues/66) · 交付：[权益估值与回撤](../src/features/risk/drawdown.ts)、[六字段交接](../harness/handoffs/P10-03.md) · 提交 [317fa2a](https://github.com/OYLPY/stock-monitor/commit/317fa2af02232f7191a20d89db47944bd0b7a62b) / [Quality CI 44034982606](https://github.com/OYLPY/stock-monitor/actions/runs/44034982606) success · 依赖：P10-01, P10-02
- [ ] [P10-04 — 模拟成交引擎、手续费与滑点](https://github.com/OYLPY/stock-monitor/issues/67) · 依赖：P10-02, P10-03, P09-02
- [ ] [P10-05 — 账本审计、指标及恢复](https://github.com/OYLPY/stock-monitor/issues/68) · 依赖：P10-04, P05-05

### [P11 自动任务、监测与通知](https://github.com/OYLPY/stock-monitor/issues/12)

- [x] [P11-01 — Worker 任务队列与调度器](https://github.com/OYLPY/stock-monitor/issues/69) · 依赖：P04-04, P05-01
- [x] [P11-02 — 美日市场时段扫描与假日异常](https://github.com/OYLPY/stock-monitor/issues/70) · 交付：[market-watch 门禁](../src/features/market-watch/market-watch.ts)、[六字段交接](../harness/handoffs/P11-02.md) · 开市但行情 Provider 未配置时为 `BLOCKED_EXTERNAL/SOURCE_UNAVAILABLE`，信号评估保持 `NOT_RUN` · 依赖：P11-01, P07-01
- [ ] [P11-03 — 重大新事件规则、去重与告警](https://github.com/OYLPY/stock-monitor/issues/71) · 依赖：P07-05, P08-03, P11-02
- [ ] [P11-04 — 晨报、日审计和周审计任务编排](https://github.com/OYLPY/stock-monitor/issues/72) · 依赖：P08-04, P11-01, P11-03
- [ ] [P11-05 — 本地通知渠道与持续运行指南](https://github.com/OYLPY/stock-monitor/issues/73) · 依赖：P11-03, P11-04

### [P12 完整测试与安全质量审计](https://github.com/OYLPY/stock-monitor/issues/13)

- [ ] [P12-01 — 单元测试覆盖风险、时间、价量与计算](https://github.com/OYLPY/stock-monitor/issues/74) · 依赖：P07-01, P09-01, P10-03
- [ ] [P12-02 — 集成测试覆盖数据库与各数据源故障](https://github.com/OYLPY/stock-monitor/issues/75) · 依赖：P07-05, P10-05, P11-03
- [ ] [P12-03 — Playwright 完整 E2E 研究与模拟计划](https://github.com/OYLPY/stock-monitor/issues/76) · 依赖：P06-06, P10-05, P11-04
- [ ] [P12-04 — 回测与研究结果可重复性审计](https://github.com/OYLPY/stock-monitor/issues/77) · 依赖：P09-06
- [ ] [P12-05 — 安全与故障恢复演练](https://github.com/OYLPY/stock-monitor/issues/78) · 依赖：P00-05, P05-05, P08-05, P11-05
- [ ] [P12-06 — 最终系统质量门禁与缺陷清零](https://github.com/OYLPY/stock-monitor/issues/79) · 依赖：P12-01, P12-02, P12-03, P12-04, P12-05

### [P13 本地发布与交付](https://github.com/OYLPY/stock-monitor/issues/14)

- [ ] [P13-01 — 安装、配置与本地运行手册](https://github.com/OYLPY/stock-monitor/issues/80) · 依赖：P12-06
- [ ] [P13-02 — 产品使用手册与研究风险说明](https://github.com/OYLPY/stock-monitor/issues/81) · 依赖：P12-03
- [ ] [P13-03 — 本地发布脚本、备份及重装验收](https://github.com/OYLPY/stock-monitor/issues/82) · 依赖：P13-01, P05-05
- [ ] [P13-04 — 最终交付报告与未完成事项登记](https://github.com/OYLPY/stock-monitor/issues/83) · 依赖：P13-02, P13-03

### 跨阶段 UI 组件治理

- [x] [UI-COMP-01 — 全页面 shadcn 标准组件与分类布局 UX](https://github.com/OYLPY/stock-monitor/issues/89) · 交付：`components.json`、`src/components/shadcn`、`src/app`、`src/components`、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/UI-COMP-01.md) · 最终修复 `5bb5141` / [Quality CI 44025841254](https://github.com/OYLPY/stock-monitor/actions/runs/44025841254) success · 覆盖：RQ-027、NFR-011/012 · 依赖：P06-01–06

## 规则

- 每项工作关联一个 GitHub Issue；保存具体验证命令、实际退出码和 main 提交 SHA；不能以手写勾选代替 GitHub 当前状态。
- P00 根 Issue（#1）是阶段门禁；只有五个子 Issue 均关闭且根 Issue 验收证据齐全时，才关闭该父 Issue。
- 自动执行器从 backlog JSON 读取受控任务内容并检查本地依赖状态；协调会话在启动前核对 GitHub Issue 仍开放且其依赖已关闭。执行器不持有 GitHub 凭据，也不修改 Issue。
