# GitHub Issue 索引

> 原子任务与阶段门禁的单一导航入口。关闭 Issue 前须有真实验证记录和已 push 到 `main` 的提交 SHA。

**总计** 14 个阶段、69 个原子任务、83 个 Issues（包含原有 P00 主单）。

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

## 全部任务

### [P00 工程创建与自主执行基础](https://github.com/OYLPY/stock-monitor/issues/1)

- [ ] [P00-01 — 创建 Next.js 应用与可复现环境](https://github.com/OYLPY/stock-monitor/issues/15) · 依赖：无
- [ ] [P00-02 — 建立质量、安全和仓库协作规范](https://github.com/OYLPY/stock-monitor/issues/16) · 依赖：P00-01
- [ ] [P00-03 — 实现 Codex 自动任务执行器](https://github.com/OYLPY/stock-monitor/issues/17) · 依赖：P00-02
- [ ] [P00-04 — NVIDIA 短上下文压缩与交接能力](https://github.com/OYLPY/stock-monitor/issues/18) · 依赖：P00-03
- [ ] [P00-05 — P00 故障恢复与阶段验收](https://github.com/OYLPY/stock-monitor/issues/19) · 依赖：P00-03, P00-04

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

### [P01 需求设计](https://github.com/OYLPY/stock-monitor/issues/2)

- [ ] [P01-01 — PRD 与用户场景/范围](https://github.com/OYLPY/stock-monitor/issues/20) · 依赖：P00-02
- [ ] [P01-02 — 晨报、异常监控与 AI 研究功能需求](https://github.com/OYLPY/stock-monitor/issues/21) · 依赖：P01-01
- [ ] [P01-03 — 纸面交易、回测、风控需求](https://github.com/OYLPY/stock-monitor/issues/22) · 依赖：P01-01
- [ ] [P01-04 — 非功能需求与验收追踪矩阵](https://github.com/OYLPY/stock-monitor/issues/23) · 依赖：P01-02, P01-03

### [P02 系统基本设计](https://github.com/OYLPY/stock-monitor/issues/3)

- [ ] [P02-01 — 系统上下文、容器及模块分层](https://github.com/OYLPY/stock-monitor/issues/24) · 依赖：P01-04
- [ ] [P02-02 — 市场数据与证据溯源架构](https://github.com/OYLPY/stock-monitor/issues/25) · 依赖：P02-01
- [ ] [P02-03 — AI 六角色编排与确定性风控边界](https://github.com/OYLPY/stock-monitor/issues/26) · 依赖：P02-01
- [ ] [P02-04 — ADR 与安全/运行故障设计](https://github.com/OYLPY/stock-monitor/issues/27) · 依赖：P02-01, P02-02, P02-03

### [P03 详细设计](https://github.com/OYLPY/stock-monitor/issues/4)

- [ ] [P03-01 — SQLite Schema、迁移与账本不变量](https://github.com/OYLPY/stock-monitor/issues/28) · 依赖：P02-01, P01-03
- [ ] [P03-02 — API/DTO 与状态机契约](https://github.com/OYLPY/stock-monitor/issues/29) · 依赖：P02-01, P03-01
- [ ] [P03-03 — 风险算法与订单仓位计算](https://github.com/OYLPY/stock-monitor/issues/30) · 依赖：P03-01
- [ ] [P03-04 — 指标/回测与评分详细设计](https://github.com/OYLPY/stock-monitor/issues/31) · 依赖：P03-01, P01-03
- [ ] [P03-05 — 任务调度、事件指纹、通知与上下文状态机](https://github.com/OYLPY/stock-monitor/issues/32) · 依赖：P02-04, P03-02

### [P04 技术可行性验证](https://github.com/OYLPY/stock-monitor/issues/5)

- [ ] [P04-01 — Codex SDK 本地授权与流式调用 PoC](https://github.com/OYLPY/stock-monitor/issues/33) · 依赖：P03-02
- [ ] [P04-02 — SQLite/Drizzle 精度与迁移 PoC](https://github.com/OYLPY/stock-monitor/issues/34) · 依赖：P03-01
- [ ] [P04-03 — 美日历史/公告数据适配器 PoC](https://github.com/OYLPY/stock-monitor/issues/35) · 依赖：P02-02
- [ ] [P04-04 — 后台 Worker、关闭浏览器及重启恢复 PoC](https://github.com/OYLPY/stock-monitor/issues/36) · 依赖：P03-05

### [P05 数据与工程基础实现](https://github.com/OYLPY/stock-monitor/issues/6)

- [ ] [P05-01 — 建立数据库、迁移及仓储层](https://github.com/OYLPY/stock-monitor/issues/37) · 依赖：P04-02
- [ ] [P05-02 — 统一时间、金额、货币与市场标识](https://github.com/OYLPY/stock-monitor/issues/38) · 依赖：P03-02
- [ ] [P05-03 — 输入 Schema、API 基础设施与安全设置](https://github.com/OYLPY/stock-monitor/issues/39) · 依赖：P05-01, P05-02
- [ ] [P05-04 — 事件与来源仓储及审计历史](https://github.com/OYLPY/stock-monitor/issues/40) · 依赖：P05-01, P05-03
- [ ] [P05-05 — 备份、恢复和数据库完整性验证](https://github.com/OYLPY/stock-monitor/issues/41) · 依赖：P05-01, P05-04

### [P06 React UI 与体验实现](https://github.com/OYLPY/stock-monitor/issues/7)

- [ ] [P06-01 — 设计系统和应用壳层](https://github.com/OYLPY/stock-monitor/issues/42) · 依赖：P05-03
- [ ] [P06-02 — 美日市场 Dashboard 与行情图表](https://github.com/OYLPY/stock-monitor/issues/43) · 依赖：P06-01, P05-04
- [ ] [P06-03 — 异常监测与事件证据中心](https://github.com/OYLPY/stock-monitor/issues/44) · 依赖：P06-01, P05-04
- [ ] [P06-04 — 晨报及六角色策略研究工作台](https://github.com/OYLPY/stock-monitor/issues/45) · 依赖：P06-01, P05-04
- [ ] [P06-05 — 回测与纸面模拟账户界面](https://github.com/OYLPY/stock-monitor/issues/46) · 依赖：P06-01, P05-01
- [ ] [P06-06 — 设置、任务日志、通知及 E2E 页面验收](https://github.com/OYLPY/stock-monitor/issues/47) · 依赖：P06-02, P06-03, P06-04, P06-05

### [P07 行情与公开信息采集实现](https://github.com/OYLPY/stock-monitor/issues/8)

- [ ] [P07-01 — NYSE/Nasdaq/JPX 交易日历与时段判定](https://github.com/OYLPY/stock-monitor/issues/48) · 依赖：P05-02, P04-03
- [ ] [P07-02 — 美股行情/历史数据适配器](https://github.com/OYLPY/stock-monitor/issues/49) · 依赖：P07-01, P05-04
- [ ] [P07-03 — 日股行情/历史数据适配器](https://github.com/OYLPY/stock-monitor/issues/50) · 依赖：P07-01, P05-04
- [ ] [P07-04 — 公司公告、财报与官方宏观采集](https://github.com/OYLPY/stock-monitor/issues/51) · 依赖：P07-01, P05-04
- [ ] [P07-05 — 事件归一化、新旧判断与数据质量门禁](https://github.com/OYLPY/stock-monitor/issues/52) · 依赖：P07-02, P07-03, P07-04

### [P08 Codex 六角色研究执行](https://github.com/OYLPY/stock-monitor/issues/9)

- [ ] [P08-01 — Codex SDK 服务封装与任务隔离](https://github.com/OYLPY/stock-monitor/issues/53) · 依赖：P04-01, P05-03
- [ ] [P08-02 — 六角色结构化研究工作流](https://github.com/OYLPY/stock-monitor/issues/54) · 依赖：P08-01, P07-05
- [ ] [P08-03 — 研究证据引用与反幻觉校验](https://github.com/OYLPY/stock-monitor/issues/55) · 依赖：P08-02, P07-05
- [ ] [P08-04 — 晨报/异常报告/每日与每周审计生成](https://github.com/OYLPY/stock-monitor/issues/56) · 依赖：P08-02, P08-03
- [ ] [P08-05 — AI研究回归评估和上下文交接](https://github.com/OYLPY/stock-monitor/issues/57) · 依赖：P08-03, P00-04

### [P09 指标、回测与量化验证](https://github.com/OYLPY/stock-monitor/issues/10)

- [ ] [P09-01 — OHLCV 归一化与指标库](https://github.com/OYLPY/stock-monitor/issues/58) · 依赖：P07-02, P07-03, P05-02
- [ ] [P09-02 — 无未来函数的回测撮合引擎](https://github.com/OYLPY/stock-monitor/issues/59) · 依赖：P09-01, P03-04
- [ ] [P09-03 — 三类初始策略与参数边界](https://github.com/OYLPY/stock-monitor/issues/60) · 依赖：P09-01, P09-02
- [ ] [P09-04 — 样本内/样本外与 Walk-forward 实验](https://github.com/OYLPY/stock-monitor/issues/61) · 依赖：P09-02, P09-03
- [ ] [P09-05 — 2020/2022 压力与费用/汇率敏感性](https://github.com/OYLPY/stock-monitor/issues/62) · 依赖：P09-04
- [ ] [P09-06 — 五维评分与 18/25 验证候选门禁](https://github.com/OYLPY/stock-monitor/issues/63) · 依赖：P09-04, P09-05

### [P10 纸面模拟与独立风控](https://github.com/OYLPY/stock-monitor/issues/11)

- [ ] [P10-01 — 模拟账户及不可变资金流水](https://github.com/OYLPY/stock-monitor/issues/64) · 依赖：P05-01, P03-01
- [ ] [P10-02 — 纸面计划审批与确定性风险官](https://github.com/OYLPY/stock-monitor/issues/65) · 依赖：P10-01, P03-03
- [ ] [P10-03 — 20%峰值回撤阻断及跨币种权益](https://github.com/OYLPY/stock-monitor/issues/66) · 依赖：P10-01, P10-02
- [ ] [P10-04 — 模拟成交引擎、手续费与滑点](https://github.com/OYLPY/stock-monitor/issues/67) · 依赖：P10-02, P10-03, P09-02
- [ ] [P10-05 — 账本审计、指标及恢复](https://github.com/OYLPY/stock-monitor/issues/68) · 依赖：P10-04, P05-05

### [P11 自动任务、监测与通知](https://github.com/OYLPY/stock-monitor/issues/12)

- [ ] [P11-01 — Worker 任务队列与调度器](https://github.com/OYLPY/stock-monitor/issues/69) · 依赖：P04-04, P05-01
- [ ] [P11-02 — 美日市场时段扫描与假日异常](https://github.com/OYLPY/stock-monitor/issues/70) · 依赖：P11-01, P07-01
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

## 规则

- 每项工作关联一个 GitHub Issue；保存具体验证命令、实际退出码和 main 提交 SHA；不能以手写勾选代替 GitHub 当前状态。
- P00 独立根任务（#1）尚未提交工程代码，后续子任务不能误报 DONE。
- 自动执行器从 backlog JSON 读取受控任务内容并检查本地依赖状态；协调会话在启动前核对 GitHub Issue 仍开放且其依赖已关闭。执行器不持有 GitHub 凭据，也不修改 Issue。
