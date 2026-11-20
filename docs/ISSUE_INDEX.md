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
| 模拟订单、成交与只追加账本 | docs/requirements/FR_TRADE.md：FR-Trade-009/010 | AC-TRD-013/014/022–024；P10/P12 运行时验证 |
| 回测可复算、防未来函数、五维评分和 Fixture 降级 | docs/requirements/FR_TRADE.md：FR-Trade-008/011/012/013 | AC-TRD-006/010/016–019；P09/P12 运行时验证 |
| RQ—用例—明细契约完整映射 | docs/requirements/REQUIREMENTS_INDEX.md、USE_CASES.md | RQ-002、RQ-013–022 → UC-04/07/08 → FR-Trade → AC-TRD-001–024 |

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
- [x] [P06-05 — 回测与纸面模拟账户界面](https://github.com/OYLPY/stock-monitor/issues/46) · 交付：回测草稿/未验证状态、AlertDialog 一次性开户确认、本机开户 API、持久化纸面账本、`src/app/api/v1/paper-account/initialize`、`src/components/backtests`、[DOC-0009](design/API_CONTRACTS.md)、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/P06-05.md) · 覆盖：RQ-013–022、FR-Trade-004/008–013、NFR-011/012 · 依赖：P06-01, P05-01
- [x] [P06-06 — 设置、任务日志、通知及 E2E 页面验收](https://github.com/OYLPY/stock-monitor/issues/47) · 交付：[DOC-0009](design/API_CONTRACTS.md)、[DOC-0017](design/UI_DESIGN.md)、[DOC-0039](operations/backup.md)、`src/app/settings`、`src/app/tasks`、`src/app/api/v1/backup`、[六字段交接](../harness/handoffs/P06-06.md) · 覆盖：RQ-026、NFR-007/008/012 · 依赖：P06-02, P06-03, P06-04, P06-05
- [x] [P06-FU-01 — 市场监测与研究报告信息结构整改](https://github.com/OYLPY/stock-monitor/issues/93) · 提交 [c61593c](https://github.com/OYLPY/stock-monitor/commit/c61593c0de4e91771aa9cdafd5af9d694fe5dc70) / Quality CI [44751449777](https://github.com/OYLPY/stock-monitor/actions/runs/44751449777) 成功；市场页数据状态与操作分区，报告结论优先、队列/历史分栏、证据关联 · [六字段交接](../harness/handoffs/P06-FU-01.md) · [验收证据](../harness/evidence/P06-FU-01-ui-ux.md) · 依赖：P06-02, P06-04, P07-02

### [P07 行情与公开信息采集实现](https://github.com/OYLPY/stock-monitor/issues/8)

- [x] [P07-01 — NYSE/Nasdaq/JPX 交易日历与时段判定](https://github.com/OYLPY/stock-monitor/issues/48) · 交付：[版本化日历实现](../src/features/market-calendar/market-calendar.ts)、[DOC-0032 调度契约](design/SCHEDULER.md)、[六字段交接](../harness/handoffs/P07-01.md) · 覆盖：RQ-003/005、FR-Research-001/002 · 依赖：P05-02, P04-03
- [ ] [P07-02 — 美股行情/历史数据适配器](https://github.com/OYLPY/stock-monitor/issues/49) · EODHD Free 适配器已随 [c61593c](https://github.com/OYLPY/stock-monitor/commit/c61593c0de4e91771aa9cdafd5af9d694fe5dc70) 推送，Quality CI [44751449777](https://github.com/OYLPY/stock-monitor/actions/runs/44751449777) 成功；本机无 API Key、未请求真实行情，线上数据仍不可用。免费层只有最近一年、每日 20 次；原始 OHLC 与拆股调整成交量、无公司行动数据，不支持数十年策略验证或回测。状态保持 open / `BLOCKED_EXTERNAL`，不关闭 Issue；证据见 [验收记录](../harness/evidence/P07-02-market-ux.md) · [六字段交接](../harness/handoffs/P07-02.md) · 来源依据见 [DOC-0036](research/data-sources.md) · 依赖：P07-01, P05-04
- [ ] [P07-03 — 日股行情/历史数据适配器](https://github.com/OYLPY/stock-monitor/issues/50) · 状态：`BLOCKED_EXTERNAL`（Free 仅 2 年且延迟 12 周；需注册，付费计划仍未覆盖数十年；见 [DOC-0036](research/data-sources.md)） · 交接：[六字段记录](../harness/handoffs/P07-03.md) · 依赖：P07-01, P05-04
- [x] [P07-04 — 公司公告、财报与官方宏观采集](https://github.com/OYLPY/stock-monitor/issues/51) · 实现提交 [2d3b769](https://github.com/OYLPY/stock-monitor/commit/2d3b769687285b663b6265f199b88ddf1cef8c7c) / [Quality CI 43885925362](https://github.com/OYLPY/stock-monitor/actions/runs/43885925362) success；验收交接 [cb11b47](https://github.com/OYLPY/stock-monitor/commit/cb11b4748ddeb239d784d3c18dff218f4ba18664) / [Quality CI 43887584327](https://github.com/OYLPY/stock-monitor/actions/runs/43887584327) success；#51 已关闭 · 线上来源可用性仍 `NOT_VERIFIED`，EDINET/BEA 缺 key、TDnet 付费未授权、issuer IR 为手工引用 · 交接：[六字段记录](../harness/handoffs/P07-04.md) · 依赖：P07-01, P05-04
- [x] [P07-05 — 事件归一化、新旧判断与数据质量门禁](https://github.com/OYLPY/stock-monitor/issues/52) · 实现提交 [47a1004](https://github.com/OYLPY/stock-monitor/commit/47a1004b4f39c26275b44c9303299adc63c556e0) / [Quality CI 44511845436](https://github.com/OYLPY/stock-monitor/actions/runs/44511845436) success；报告采集持久化 Fed/BOJ 官方标题事件，同源重试幂等、来源修订追加；行情缺失时市场监测为 BLOCKED_EXTERNAL/NOT_VERIFIED 且不运行信号；#49/#50 仍是价量信号硬前置 · [六字段交接](../harness/handoffs/P07-05.md) · 依赖：P07-04

### [P08 Codex 六角色研究执行](https://github.com/OYLPY/stock-monitor/issues/9)

- [x] [P08-01 — Codex SDK 服务封装与任务隔离](https://github.com/OYLPY/stock-monitor/issues/53) · 交付：`src/features/ai/codex-adapter`、[六字段交接](../harness/handoffs/P08-01.md) · 实现提交：[6f98e815](https://github.com/OYLPY/stock-monitor/commit/6f98e81585dca6aa37997739d18541d36e947a68) · Quality CI：[43873045326](https://github.com/OYLPY/stock-monitor/actions/runs/43873045326) success · 依赖：P04-01, P05-03
- [x] [P08-02 — 六角色结构化研究工作流](https://github.com/OYLPY/stock-monitor/issues/54) · 交付：[六角色工作流](../src/features/research/workflows/report.ts)、[六字段交接](../harness/handoffs/P08-02.md) · 提交：[f1a88bb](https://github.com/OYLPY/stock-monitor/commit/f1a88bb6510ced148919b06b17428fcf945aed04) · Quality CI：[44328957448](https://github.com/OYLPY/stock-monitor/actions/runs/44328957448) success · 依赖：P08-01, P07-04；行情缺失仍归档 NOT_VERIFIED，候选为空
- [x] [P08-03 — 研究证据引用与反幻觉校验](https://github.com/OYLPY/stock-monitor/issues/55) · 交付：[证据 checker](../src/features/research/evidence-checker.ts)、[六字段交接](../harness/handoffs/P08-03.md) · 提交：[4517152](https://github.com/OYLPY/stock-monitor/commit/4517152030fb99b49a9e05e0c63c0963cdec9683) · Quality CI：[44334936714](https://github.com/OYLPY/stock-monitor/actions/runs/44334936714) success · 依赖：P08-02, P07-04 · 不完整/缺行情报告仍为 NOT_VERIFIED 且候选为空
- [x] [P08-04 — 晨报/异常报告/每日与每周审计生成](https://github.com/OYLPY/stock-monitor/issues/56) · 实现提交：[7a769c0](https://github.com/OYLPY/stock-monitor/commit/7a769c0c3dee1f9256e5249f6df3b3be0f7d8c0d)；Quality CI [44350769588](https://github.com/OYLPY/stock-monitor/actions/runs/44350769588) success；SQLite 版本化归档、幂等重试、失败/阻断留档、无行情时 NOT_VERIFIED 且候选为空；本地 43 files / 268 tests、E2E 5/5；定时晨报/审计仍由 P11-04/#72 负责 · 依赖：P08-02, P08-03
- [x] [P08-04 follow-up — 无股票行情时展示有来源宏观观察](https://github.com/OYLPY/stock-monitor/issues/92) · 报告从已保存的 BLS CPI/失业率及 BOJ USD/JPY 记录生成 `PARTIAL` 可追溯事实；Codex 不可用时仍可见；无美日 OHLCV 时策略候选为 0，回测/收益/模拟成交仍未验证 · 实现提交 [`dd298e9`](https://github.com/OYLPY/stock-monitor/commit/dd298e9b6ae98059986fa005943cf667c56dc450) / [Quality CI 44503264770](https://github.com/OYLPY/stock-monitor/actions/runs/44503264770) success；验收交接与 PMO 记录由当前提交补齐 · [六字段交接](../harness/handoffs/P08-04-FU-92.md)
- [x] [P08-05 — AI研究回归评估和上下文交接](https://github.com/OYLPY/stock-monitor/issues/57) · 固定 FIXTURE 对比长历史、项目 task/restart context 和 SAC checkpoint；3 次确定性重复、14/14 约束标记、已知/未知来源 ID 规则验证 · [评估报告](../harness/evidence/P08-05-context-evaluation.md) · 实现提交 [`625cefd`](https://github.com/OYLPY/stock-monitor/commit/625cefdcd11a2ccceea08a42bbecbc7557fe4739) / [Quality CI 44426464750](https://github.com/OYLPY/stock-monitor/actions/runs/44426464750) success（含 Playwright E2E） · 验收提交 CI [44427397247](https://github.com/OYLPY/stock-monitor/actions/runs/44427397247) 首次因既有事件仓储测试超 5 秒失败，attempt 2 全部通过 · 本机 format/lint/typecheck/build、44 files / 269 unit tests 通过；无模型、行情或交易 · [六字段交接](../harness/handoffs/P08-05.md) · 依赖：P08-03, P00-04

### [P09 指标、回测与量化验证](https://github.com/OYLPY/stock-monitor/issues/10)

- [x] [P09-01 — OHLCV 归一化与指标库](https://github.com/OYLPY/stock-monitor/issues/58) · 依赖：P05-02（供应商接入 P07-02/P07-03 不阻塞；按 DOC-0011 点时调整契约）。
- [x] [P09-02 — 无未来函数的回测撮合引擎](https://github.com/OYLPY/stock-monitor/issues/59) · 依赖：P09-01, P03-04
- [x] [P09-03 — 三类初始策略与参数边界](https://github.com/OYLPY/stock-monitor/issues/60) · 依赖：P09-01, P09-02 · 提交 e994228 / Quality CI 44228498133 成功
- [x] [P09-04 — 样本内/样本外与 Walk-forward 实验](https://github.com/OYLPY/stock-monitor/issues/61) · 依赖：P09-02, P09-03 · 实现提交 e222ccb / CI 44233159341、验收提交 d121993 / CI 44234313457 均成功；#61 已关闭
- [x] [P09-05 — 2020/2022 压力与费用/汇率敏感性](https://github.com/OYLPY/stock-monitor/issues/62) · 依赖：P09-04 · 实现 `a8211c0` / [Quality CI 44240857019](https://github.com/OYLPY/stock-monitor/actions/runs/44240857019) 成功；[六字段交接](../harness/handoffs/P09-05.md)
- [x] [P09-06 — 五维评分与 18/25 验证候选门禁](https://github.com/OYLPY/stock-monitor/issues/63) · 实现提交 [`d04d7fc`](https://github.com/OYLPY/stock-monitor/commit/d04d7fcb39882a357839518b29d5201cd23d41b5) / 免费 [Quality CI 44246049844](https://github.com/OYLPY/stock-monitor/actions/runs/44246049844) 成功；[六字段交接](../harness/handoffs/P09-06.md) · 依赖：P09-04, P09-05

### [P10 纸面模拟与独立风控](https://github.com/OYLPY/stock-monitor/issues/11)

- [x] [P10-01 — 模拟账户及不可变资金流水](https://github.com/OYLPY/stock-monitor/issues/64) · 交付：[纸面账本](../src/features/paper/ledger.ts)、[六字段交接](../harness/handoffs/P10-01.md) · 实现提交 f3d87fc / [Quality CI 44012299880](https://github.com/OYLPY/stock-monitor/actions/runs/44012299880)；迁移兼容修复 fa7331c / [Quality CI 44016190625](https://github.com/OYLPY/stock-monitor/actions/runs/44016190625)；备份测试修正 8a077c9 / [Quality CI 44017397513](https://github.com/OYLPY/stock-monitor/actions/runs/44017397513) · 依赖：P05-01, P03-01
- [x] [P10-02 — 纸面计划审批与确定性风险官](https://github.com/OYLPY/stock-monitor/issues/65) · 交付：[风险检查器](../src/features/risk/checker.ts)、[六字段交接](../harness/handoffs/P10-02.md) · 提交 [`5bb5141`](https://github.com/OYLPY/stock-monitor/commit/5bb5141d441c6f256250375f5daf4a25282b40c8) / [Quality CI 44025841254](https://github.com/OYLPY/stock-monitor/actions/runs/44025841254) success · 依赖：P10-01, P03-03
- [x] [P10-03 — 20%峰值回撤阻断及跨币种权益](https://github.com/OYLPY/stock-monitor/issues/66) · 交付：[权益估值与回撤](../src/features/risk/drawdown.ts)、[六字段交接](../harness/handoffs/P10-03.md) · 提交 [317fa2a](https://github.com/OYLPY/stock-monitor/commit/317fa2af02232f7191a20d89db47944bd0b7a62b) / [Quality CI 44034982606](https://github.com/OYLPY/stock-monitor/actions/runs/44034982606) success · 依赖：P10-01, P10-02
- [x] [P10-04 — 模拟成交引擎、手续费与滑点](https://github.com/OYLPY/stock-monitor/issues/67) · 交付：[成交引擎](../src/features/paper/fill-engine.ts)、[六字段交接](../harness/handoffs/P10-04.md) · 提交 [`8cfde52`](https://github.com/OYLPY/stock-monitor/commit/8cfde5256d834d88b3a1820c7ee265bb8e8e72fe) / [Quality CI 44255658762](https://github.com/OYLPY/stock-monitor/actions/runs/44255658762) success · 依赖：P10-02, P10-03, P09-02
- [x] [P10-05 — 账本审计、指标及恢复](https://github.com/OYLPY/stock-monitor/issues/68) · 实现 [`9fedda8`](https://github.com/OYLPY/stock-monitor/commit/9fedda8f53fc2aa14f3e7717ed5684a982500078) / [Quality CI 44263245240](https://github.com/OYLPY/stock-monitor/actions/runs/44263245240) success；交接 [`8b4f674`](https://github.com/OYLPY/stock-monitor/commit/8b4f67441894e63875ac1fe2e21be39d6916a75d) / [Quality CI 44263902351](https://github.com/OYLPY/stock-monitor/actions/runs/44263902351) success；#68 已关闭 · [六字段交接](../harness/handoffs/P10-05.md) · 依赖：P10-04, P05-05

### [P11 自动任务、监测与通知](https://github.com/OYLPY/stock-monitor/issues/12)

- [x] [P11-01 — Worker 任务队列与调度器](https://github.com/OYLPY/stock-monitor/issues/69) · 依赖：P04-04, P05-01
- [x] [P11-01 Follow-up — 自动启动与持久化任务队列管理](https://github.com/OYLPY/stock-monitor/issues/90) · 实现 [`f951fa3`](https://github.com/OYLPY/stock-monitor/commit/f951fa32264d1a1020d41b551dbd7699d5f9454c) / Quality CI [44462349343](https://github.com/OYLPY/stock-monitor/actions/runs/44462349343) success；队列表、刷新持久化、安全取消、`pnpm dev/start` 启动 Worker 均通过验收 · [六字段交接](../harness/handoffs/P11-01-FU-90.md) · [验收记录](../harness/evidence/P11-01-followup-90.md) · 依赖：P11-01/#69
- [x] [P11-02 — 美日市场时段扫描与假日异常](https://github.com/OYLPY/stock-monitor/issues/70) · 交付：[market-watch 门禁](../src/features/market-watch/market-watch.ts)、[六字段交接](../harness/handoffs/P11-02.md) · 开市但行情 Provider 未配置时为 `BLOCKED_EXTERNAL/SOURCE_UNAVAILABLE`，信号评估保持 `NOT_RUN` · 依赖：P11-01, P07-01
- [x] [P11-03 — 重大新事件规则、去重与告警](https://github.com/OYLPY/stock-monitor/issues/71) · 实现 [`56c289f`](https://github.com/OYLPY/stock-monitor/commit/56c289fbbaec0561a7a8659c73511801b39795e1) / Quality CI [44522557415](https://github.com/OYLPY/stock-monitor/actions/runs/44522557415) success；7/7 E2E 与 52 files / 307 unit tests 通过；生产 RSS 许可未核验、#49/#50 行情 Provider 阻断，故实时提醒仍 fail-closed · [六字段交接](../harness/handoffs/P11-03.md) · 依赖：P07-05, P08-03, P11-02
- [x] [P11-04 — 晨报、日审计和周审计任务编排](https://github.com/OYLPY/stock-monitor/issues/72) · 实现：[定时报告](../src/features/reports/jobs.ts)、[报告任务](../src/features/reports/task.ts)；Asia/Tokyo 晨报 07:00、日审计 16:00、周审计周一 07:30，缺少证据时归档 `NOT_VERIFIED` 且零候选 · 实现提交 [54a3181](https://github.com/OYLPY/stock-monitor/commit/54a3181fde684209211c8c71194efd7a8491e69c) / Quality CI [44433188280](https://github.com/OYLPY/stock-monitor/actions/runs/44433188280) success；验收记录 [c5c173a](https://github.com/OYLPY/stock-monitor/commit/c5c173aa1b5ab986ad8e88032096123407a12d1e) / Quality CI [44434740313](https://github.com/OYLPY/stock-monitor/actions/runs/44434740313) success；#72 已关闭 · [六字段交接](../harness/handoffs/P11-04.md) · 依赖：P08-04, P11-01；盘中扫描/异常告警仍由 P11-03 负责
- [x] [P11-05 — 本地通知渠道与持续运行指南](https://github.com/OYLPY/stock-monitor/issues/73) · 实现提交 [`3b07473`](https://github.com/OYLPY/stock-monitor/commit/3b07473560c58680e4b41ca243ecfb71f014994e) / Quality CI [44536824296](https://github.com/OYLPY/stock-monitor/actions/runs/44536824296) success · 显式授权后浏览器通知和静默开关、持久通知游标 API；Windows Task Scheduler/macOS LaunchAgent 操作步骤见 [DOC-0041](operations/local-runtime-notifications.md) · v14 兼容与 v15 前向迁移保留原库数据 · [六字段交接](../harness/handoffs/P11-05.md) · 依赖：P11-03, P11-04
- [x] [P11-06 — 报告任务自动采集官方宏观与央行公告](https://github.com/OYLPY/stock-monitor/issues/91) · 实现 [`62c63d3`](https://github.com/OYLPY/stock-monitor/commit/62c63d37ed0e1cd1a683fe9ec3915ad232fd7552) / Quality CI [44472642104](https://github.com/OYLPY/stock-monitor/actions/runs/44472642104) success；本地 48 files / 283 tests、build、Playwright 6/6 均通过；公开来源只读 smoke 与限制见 [验收记录](../harness/evidence/P11-06-followup-91.md)；[六字段交接](../harness/handoffs/P11-06-FU-91.md) · 无股票 OHLCV 时仍零策略候选

### [P12 完整测试与安全质量审计](https://github.com/OYLPY/stock-monitor/issues/13)

- [x] [P12-01 — 单元测试覆盖风险、时间、价量与计算](https://github.com/OYLPY/stock-monitor/issues/74) · 依赖：P07-01, P09-01, P10-03
- [x] [P12-02 — 集成测试覆盖数据库与各数据源故障](https://github.com/OYLPY/stock-monitor/issues/75) · [验收证据](../harness/evidence/P12-02-integration.md) · 实现 [`9f0e63d`](https://github.com/OYLPY/stock-monitor/commit/9f0e63dc2fb804dbb679b16457264b4a418d83b1) / CI [44758467681](https://github.com/OYLPY/stock-monitor/actions/runs/44758467681) · 验收 [`4d1de77`](https://github.com/OYLPY/stock-monitor/commit/4d1de77d82be8a2224672a7674dc3d25d9712077) / CI [44759357324](https://github.com/OYLPY/stock-monitor/actions/runs/44759357324) · 边界澄清 [`263996a`](https://github.com/OYLPY/stock-monitor/commit/263996a79eab971bb6959984eeddb31bdadfbed2) / CI [44759990620](https://github.com/OYLPY/stock-monitor/actions/runs/44759990620) · #75 已关闭 · 依赖：P07-05, P10-05, P11-03
- [x] [P12-03 — Playwright 完整 E2E 研究与模拟计划](https://github.com/OYLPY/stock-monitor/issues/76) · 实现提交 [f1af657](https://github.com/OYLPY/stock-monitor/commit/f1af657f6094f2a2f80f753d2443ec5ea906c4c9) / Quality CI [44441115531](https://github.com/OYLPY/stock-monitor/actions/runs/44441115531) success；验收记录 [0eaaf45](https://github.com/OYLPY/stock-monitor/commit/0eaaf453f8965531add735871830aa18bed19fa3) / Quality CI [44441657092](https://github.com/OYLPY/stock-monitor/actions/runs/44441657092) success；#76 已关闭 · [E2E 证据](../harness/evidence/P12-03-e2e.md) · [六字段交接](../harness/handoffs/P12-03.md) · 依赖：P06-06, P10-05, P11-04
- [x] [P12-04 — 回测与研究结果可重复性审计](https://github.com/OYLPY/stock-monitor/issues/77) · 依赖：P09-06
- [ ] [P12-05 — 安全与故障恢复演练](https://github.com/OYLPY/stock-monitor/issues/78) · 依赖：P00-05, P05-05, P08-05, P11-05
- [ ] [P12-06 — 最终系统质量门禁与缺陷清零](https://github.com/OYLPY/stock-monitor/issues/79) · 依赖：P12-01, P12-02, P12-03, P12-04, P12-05

### [P13 本地发布与交付](https://github.com/OYLPY/stock-monitor/issues/14)

- [ ] [P13-01 — 安装、配置与本地运行手册](https://github.com/OYLPY/stock-monitor/issues/80) · 依赖：P12-06
- [x] [P13-02 — 产品使用手册与研究风险说明](https://github.com/OYLPY/stock-monitor/issues/81) · DOC-0040：[产品使用指南](USER_GUIDE.md) · main 提交 [2c910a9](https://github.com/OYLPY/stock-monitor/commit/2c910a93e846cde6685c17007f9fa937346c162d) / Quality CI [44445047507](https://github.com/OYLPY/stock-monitor/actions/runs/44445047507) success（含 E2E）；#81 已关闭 · [验收记录](../harness/evidence/P13-02-documentation.md) · [六字段交接](../harness/handoffs/P13-02.md) · 依赖：P12-03
- [ ] [P13-03 — 本地发布脚本、备份及重装验收](https://github.com/OYLPY/stock-monitor/issues/82) · 依赖：P13-01, P05-05
- [ ] [P13-04 — 最终交付报告与未完成事项登记](https://github.com/OYLPY/stock-monitor/issues/83) · 依赖：P13-02, P13-03

### 跨阶段 UI 组件治理

- [x] [UI-COMP-01 — 全页面 shadcn 标准组件与分类布局 UX](https://github.com/OYLPY/stock-monitor/issues/89) · 交付：`components.json`、`src/components/shadcn`、`src/app`、`src/components`、[DOC-0017](design/UI_DESIGN.md)、[六字段交接](../harness/handoffs/UI-COMP-01.md) · 最终修复 `5bb5141` / [Quality CI 44025841254](https://github.com/OYLPY/stock-monitor/actions/runs/44025841254) success · 覆盖：RQ-027、NFR-011/012 · 依赖：P06-01–06

## 规则

- 每项工作关联一个 GitHub Issue；保存具体验证命令、实际退出码和 main 提交 SHA；不能以手写勾选代替 GitHub 当前状态。
- P00 根 Issue（#1）是阶段门禁；只有五个子 Issue 均关闭且根 Issue 验收证据齐全时，才关闭该父 Issue。
- 自动执行器从 backlog JSON 读取受控任务内容并检查本地依赖状态；协调会话在启动前核对 GitHub Issue 仍开放且其依赖已关闭。执行器不持有 GitHub 凭据，也不修改 Issue。
