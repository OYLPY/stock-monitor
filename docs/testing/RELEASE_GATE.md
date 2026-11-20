# P12-06 最终质量门禁与已知缺陷

> Doc ID: DOC-0043 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

**工作项：** [P12-06 / #79](https://github.com/OYLPY/stock-monitor/issues/79)

## 目标、范围与基线提交

在 `main` 基线 `57509740f592d5f1b26e39bbccd6cc21ba274520` 上完成 P12-06 本地离线质量门禁，修复高容量纸面账本审计与读取缺陷，并保留未完成产品项。仅使用仓库代码、临时 SQLite 与合成 Fixture；没有读取应用数据库、真实行情、Codex 私有认证或券商账户。

本次修复将账本流水改为每页读取 100 个事件，并确保同一事件的多个现金分录完整显示；改为 SQLite 子查询后，账本审计和纸面重放不再把全部事件/订单 ID 展开为 SQLite 参数。开户接口使用账户存在性查询，避免为幂等判断加载整本流水。

## 环境与数据/Fixture 状态

- Windows `10.0.26300`，Node `v22.14.0`，pnpm `11.25.0`，Next.js `16.4.6`，SQLite `3.54.1`。
- 回归测试与基准只使用隔离临时文件数据库；基准包含 100,000 条合成 `FEE` 账本事件和 250,000 条合成 OHLCV 行。OHLCV 不是市场事实，全部数据仅用于本地容量测量。
- E2E 使用独立临时数据库、本机临时端口及模拟执行器配置；未请求外部行情/新闻服务，也未调用真实 Codex。
- 账本分页仅使用已安装的 shadcn `Pagination`；没有修改 `src/components/ui/*` 或生成组件源码。

## 执行命令与退出码

| 命令                                                       | 结果                                              |
| ---------------------------------------------------------- | ------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile`                  | exit 0；依赖已满足锁文件                          |
| `corepack pnpm format:check`                               | exit 0                                            |
| `corepack pnpm exec eslint src scripts tests`              | exit 0                                            |
| `corepack pnpm typecheck`                                  | exit 0                                            |
| `corepack pnpm test`                                       | exit 0；57 files / 329 tests                      |
| `corepack pnpm test:integration`                           | exit 0；1 file / 2 tests                          |
| `corepack pnpm test:e2e`                                   | exit 0；10 / 10 Playwright cases                  |
| `corepack pnpm build`                                      | exit 0；Next.js production build                  |
| `corepack pnpm exec tsx scripts/benchmark-paper-ledger.ts` | exit 0；100,000 ledger events、250,000 price rows |

Playwright 使用端口 3003 的隔离运行；没有对用户当前打开的端口 3000 实例做视觉验收。报告/市场页面的 UX 验收仍由 [P06-FU-02 / #94](https://github.com/OYLPY/stock-monitor/issues/94) 跟踪。

## 结果、数量与失败位置

| 指标                  |                                         观察结果 | 边界                                             |
| --------------------- | -----------------------------------------------: | ------------------------------------------------ |
| 账本首 100 条分页查询 | 30 次样本 P95：39.90 ms；每次最多返回 100 个事件 | 临时合成数据库；不代表用户机器全部负载           |
| 完整合成账本审计      |              `VERIFIED`，0 个审计问题；738.60 ms | 事件均为合成费用事件，不含真实订单/成交分布      |
| SQLite 关闭后重开     |                                         15.04 ms | 仅数据库打开和本地审计，不是主机/Worker 重启演练 |
| 100,000 事件备份      |                      1,321.31 ms；状态 `created` | 同一临时数据库                                   |
| 100,000 事件恢复      |               2,410.85 ms；恢复后审计 `VERIFIED` | 恢复库含 100,000 账本事件、250,000 合成 OHLCV 行 |

本轮完整单测新增了 32,768 条账本事件审计回归，确认大账本不再因 SQLite 绑定变量上限失败。所有已执行的质量命令最终通过；一次 `typecheck` 发现基准脚本读取 SQLite 聚合值时的类型错误，修正为标量查询后重跑通过。没有为通过检查删除断言或降低门槛。

## 未完成项、缺陷与交付判定

- **UX 验收未完成：** 用户明确指出报告和市场监测页面仍然难以理解、信息过载。#93 的实现没有满足当前反馈；#94 已建立为下一项修复，关闭前不声称两页已获用户验收。
- **真实美股数据未验证：** #49 仅批准可选免费 EODHD 源；本机没有 API Key，未请求云端，线上行情不可用，策略信号和历史绩效不可核验。
- **真实日股数据受阻：** #50 仍为 `BLOCKED_EXTERNAL`；没有符合当前历史覆盖要求的免费来源。
- **首屏 Ready P95 未测：** AC-NFR-003 的页面启动 30 次测量未在本任务执行。
- **Worker 主机重启未验收：** 本轮 SQLite 重开时间不能替代宿主机/Worker 中断后的端到端恢复验证。
- **无真实量化结果：** 基准、E2E 和测试 Fixture 不能被解释为市场行情、策略绩效、模拟成交或账户收益。
- **远端门禁：** 实现与证据提交 `8ff3bf77e45ee5695cafd7b5f4b3470a00e39e85` 的 GitHub Quality CI [44776716414](https://github.com/OYLPY/stock-monitor/actions/runs/44776716414) 成功；最终交接/状态提交 `bb198b1162491df728952d9f6e9d8a8c59866055` 的匹配 CI [44777577729](https://github.com/OYLPY/stock-monitor/actions/runs/44777577729) 也成功。

因此，本次代码级质量检查通过，但产品交付仍为 **PARTIAL_DELIVERY**；报告/市场 UX 缺陷与真实行情来源完成前，不标记系统整体 READY。

## 遗留本机临时文件

初次尝试逐行播种的基准在耗时过长后被中止，遗留一个约 116 MB 的临时 SQLite 目录：`%TEMP%\stock-monitor-test-ldgDDi`。已确认它由该次隔离基准创建；本地清理操作被执行环境拒绝，未改用其他删除方式。它不包含用户数据库或真实行情；后续可在系统策略允许时手工删除。

## 关联 Issue、需求和设计

- P12-06 / #79；报告与市场监测 UX：P06-FU-02 / #94；先前 UX 实现：P06-FU-01 / #93。
- NFR-002 / AC-NFR-004：账本分页性能；NFR-005：本机存储恢复；NFR-007 / AC-NFR-011：备份与恢复。
- [数据库设计](../design/DB_SCHEMA.md)、[需求追踪矩阵](../requirements/TRACEABILITY.md)、[安全与故障恢复演练](SECURITY_AUDIT.md)。
