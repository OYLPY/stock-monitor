# V1 需求—设计—验收追踪矩阵

> Doc ID: DOC-0023 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

> 状态：P01-04 追踪基线。所有 AC 编号表示未来实现必须满足的输入/结果，不表示相关代码或测试已存在/通过。实际提交、命令、运行结果和证据链接应在对应 Issue 与 P12 记录。
>
> 入口：[需求索引](REQUIREMENTS_INDEX.md)、[FR-Research](FR_RESEARCH.md)、[FR-Trade](FR_TRADE.md)、[NFR](NFR.md)、[用户用例](USE_CASES.md)、[Issue 导航](../ISSUE_INDEX.md)、[开发计划](../DEVELOPMENT_PLAN.md)。

## 状态含义

| 状态                                          | 含义                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SPECIFIED`                                   | 产品要求和对应 AC 已在 P01 文档中定义。                                                          |
| `IMPLEMENTATION_PENDING`                      | 责任设计/实现 Issue 尚未以代码和测试完成验收；不得报告运行通过。                                 |
| `IMPLEMENTED / REGRESSION_VALIDATION_PENDING` | 前置实现 Issue 已有代码和对应验证证据；P12 的完整回归仍未完成，不表示当前 Issue 已重新运行验证。 |
| `OUT_OF_SCOPE`                                | `REQUIREMENTS_INDEX.md` 标为 OUT；P12/P13 仍需确认没有意外实现入口。                             |
| `BLOCKED_EXTERNAL`                            | 只用于缺少授权/凭据/供应商等外部条件，须记录责任与恢复条件；不可替代失败测试。                   |

RQ-029 的基线实现已在 [P00-04 / #18](https://github.com/OYLPY/stock-monitor/issues/18) 完成，提交 `c7d764712333b73f886beac1d0c53b7d396a1923` 的 [Quality CI](https://github.com/OYLPY/stock-monitor/actions/runs/43689402274) 成功；P12-05 的安全与恢复回归仍待执行。

## 产品级 RQ 矩阵

| RQ     | 功能细化 / NFR                                     | 设计和实现责任                                            | 验收编号                                         | 后续验证类型/阶段                                   | 状态                                        |
| ------ | -------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------- |
| RQ-001 | NFR-001/002/003/008/011/012                        | [ARCHITECTURE.md](../design/ARCHITECTURE.md) / P02-01；[THREAT_MODEL.md](../design/THREAT_MODEL.md) / P02-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；P05-03 / #39、P06 | AC-NFR-001–004、012、016–020 | P12-03 E2E、P12-05 security、P12-06 performance | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-002 | FR-Trade-003                                       | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10 | AC-TRD-003、009 | P12-01 unit、P12-02 integration | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-003 | FR-Research-001/002                                | [DOC-0038](../design/DOMAIN_PRIMITIVES.md) / P05-02（当地日期映射）；[market-calendar](../../src/features/market-calendar/market-calendar.ts) / P07-01；[market-watch](../../src/features/market-watch/market-watch.ts) / P11-02；[SCHEDULER.md](../design/SCHEDULER.md) / P03-05；P02-02 | AC-RES-001–006 | P07-01 calendar tests；P11-02 market-watch time-window/Worker tests；P12-01 unit、P12-02 integration | SPECIFIED / IMPLEMENTED_PARTIAL |
| RQ-004 | FR-Research-007                                    | [DOC-0017](../design/UI_DESIGN.md) / P06-04（报告历史 UI）；P08-04、P11-04 | AC-RES-013/014/021 | P06-04 reports UI projection tests；P12-03 E2E | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-005 | FR-Research-001/002                                | [market-calendar](../../src/features/market-calendar/market-calendar.ts) / P07-01；[market-watch](../../src/features/market-watch/market-watch.ts) / P11-02；[SCHEDULER.md](../design/SCHEDULER.md) / P03-05；P11-02 | AC-RES-001–006 | P07-01 calendar tests；P11-02 market-watch time-window/Worker tests；P12-01 unit、P12-02 integration | SPECIFIED / IMPLEMENTED_PARTIAL |
| RQ-006 | FR-Research-003/004/005                            | [SCHEDULER.md](../design/SCHEDULER.md) / P03-05；P08-03、P11-03 | AC-RES-007–012 | P12-02 integration、P12-03 E2E | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-007 | FR-Research-008/009、FR-Trade-012                  | [DOC-0017](../design/UI_DESIGN.md) / P06-04（证据、候选与风控意见 UI）；P08-02、P09-06 | AC-RES-015/016/023、AC-TRD-018 | P06-04 reports UI projection tests；P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-008 | FR-Research-009                                    | [DOC-0017](../design/UI_DESIGN.md) / P06-04（审计历史 UI）；P08-04、P11-04 | AC-RES-019 | P06-04 reports UI projection tests；P12-03 E2E、P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-009 | FR-Research-008/009                                | [AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03、P08；[DOC-0017](../design/UI_DESIGN.md) / P06-04（六角色审计 UI） | AC-RES-020 | P06-04 reports UI projection tests；P12-05 security/permission test | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-010 | FR-Research-006/010/011、NFR-009                   | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-04 / #40；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[DOC-0036](../research/data-sources.md) / P04-03；[DOC-0017](../design/UI_DESIGN.md) / P06-02（溯源展示）；P05-02 / [DOC-0038](../design/DOMAIN_PRIMITIVES.md)、P07、P08 | AC-RES-011/022、AC-NFR-014 | P05-04 file-backed repository tests；P12-02 integration、P12-04 audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-011 | FR-Research-006/010/011、FR-Trade-013、NFR-009/010 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02、P05-04 / #40；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[BACKTEST_ENGINE.md](../design/BACKTEST_ENGINE.md) / P03-04；[DOC-0036](../research/data-sources.md) / P04-03；[DOC-0017](../design/UI_DESIGN.md) / P06-02（数据状态展示）；P07、P08、P09、P10 | AC-RES-017、AC-TRD-017/019、AC-NFR-013–015 | P05-04 classification/gating tests；P12-03 E2E、P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-012 | FR-Research-008                                    | P08-02、P08-04                                            | AC-RES-015/023                                   | P12-03 E2E、P12-04 quant audit                      | SPECIFIED / IMPLEMENTATION_PENDING          |
| RQ-013 | FR-Trade-011                                       | [BACKTEST_ENGINE.md](../design/BACKTEST_ENGINE.md) / P03-04；[DOC-0017](../design/UI_DESIGN.md) / P06-05（参数、运行与 NOT_VERIFIED 状态）；P09 | AC-TRD-016/017 | P06-05 BacktestsPage tests；P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-014 | FR-Trade-012                                       | [BACKTEST_ENGINE.md](../design/BACKTEST_ENGINE.md) / P03-04；[DOC-0017](../design/UI_DESIGN.md) / P06-05（不伪造评分）；P09-06 | AC-TRD-018 | P06-05 BacktestsPage tests；P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-015 | FR-Trade-004                                       | [DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-01、P10；[DOC-0017](../design/UI_DESIGN.md) / P06-05（开户/未开户展示） | AC-TRD-001/002 | P05-01 `src/db/db.test.ts`、P06-05 paper account repository tests、P12-02 integration | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-016 | FR-Trade-005/006/008                               | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03；[DOC-0017](../design/UI_DESIGN.md) / P06-05（不完整成本/风险状态）；P10 | AC-TRD-005/006/010/011 | P06-05 BacktestsPage tests；P12-01 unit、P12-02 integration | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-017 | FR-Trade-005/007                                   | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03；[DOC-0017](../design/UI_DESIGN.md) / P06-05（固定回撤边界）；P10 | AC-TRD-006/007 | P06-05 BacktestsPage tests；P12-01 unit、P12-02 integration | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-018 | FR-Trade-003/009/013、NFR-001/008                  | [ARCHITECTURE.md](../design/ARCHITECTURE.md) / P02-01、P02-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10；[DOC-0017](../design/UI_DESIGN.md) / P06-05（模拟订单状态与禁用写入） | AC-TRD-003/013/019、AC-NFR-001/002/012 | P06-05 BacktestsPage tests；P12-02 integration、P12-05 security | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-019 | FR-Trade-002/006/007/008                           | [API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10；[DOC-0017](../design/UI_DESIGN.md) / P06-05（固定风险边界与未核验当前裁决） | AC-RES-016、AC-TRD-004–007 | P06-05 BacktestsPage tests；P12-01 unit、P12-02 integration | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-020 | FR-Trade-001/002/009/010                           | [AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[DOC-0017](../design/UI_DESIGN.md) / P06-05（无直接订单或账本写入）；P10 | AC-TRD-004/013/014 | P06-05 BacktestsPage tests；P12-02 integration | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-021 | FR-Trade-004/010、NFR-005/006                      | [DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-01；[DOC-0017](../design/UI_DESIGN.md) / P06-05（真实开户流水和权益缺失状态）；P10 | AC-TRD-001/002/014、AC-NFR-009/010 | P05-01 `src/db/db.test.ts`、P06-05 paper account repository tests、P12-02 integration、P12-05 recovery | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-022 | FR-Trade-005/006/008/011                           | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03；[DOC-0038](../design/DOMAIN_PRIMITIVES.md) / P05-02；[DOC-0017](../design/UI_DESIGN.md) / P06-05（成本/行情证据状态）；P03-04、P09、P10 | AC-TRD-005/006/008–012/016/017 | P06-05 BacktestsPage tests；P12-01 unit、P12-02 integration、P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-023 | FR-Research-009、NFR-004/005                       | [ARCHITECTURE.md](../design/ARCHITECTURE.md) / P02-01；[ADR-0003](../decisions/0003-independent-worker-for-schedules.md) / P02-04；[SCHEDULER.md](../design/SCHEDULER.md) / P03-05/P11-01；[DOC-0037](../research/p04-04-worker-runtime-findings.md) / P04-04 PoC；P11-02/04 | AC-NFR-007–009 | P04-04 browser-close PoC; `src/features/task-queue/task-queue.test.ts` queue/lease/worker-thread coverage; P12-02 integration、P12-05 recovery | SPECIFIED / IMPLEMENTED_PARTIAL |
| RQ-024 | NFR-004/005 | [FAILURE_MODES.md](../design/FAILURE_MODES.md) / P02-04；[WORKFLOW_STATE.md](../design/WORKFLOW_STATE.md) / P03-05/P11-01；[ARCHITECTURE.md](../design/ARCHITECTURE.md) / P05-01、P11-01/03；P08-01 Codex adapter | AC-NFR-005–008 | P11-01 `src/features/task-queue/task-queue.test.ts` timeout/worker cancellation; P08-01 zero request/stream retries with WebSocket disabled: disconnect, HTTP 429, and flat SSE error each made 1 loopback request; remote Codex cancellation semantics NOT_VERIFIED; P12-02 integration pending | SPECIFIED / IMPLEMENTED_PARTIAL |
| RQ-025 | NFR-008                                            | [THREAT_MODEL.md](../design/THREAT_MODEL.md) / P02-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；P05-03 / #39、P08-05 | AC-NFR-002/012/022 | P12-05 security | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-026 | NFR-007                                            | [ADR-0001](../decisions/0001-sqlite-system-of-record.md) / P02-04；[DOC-0013](../design/DB_SCHEMA.md) / P03-01、P05-05；[DOC-0035](../research/p04-02-sqlite-drizzle-findings.md) / P04-02；[DOC-0039](../operations/backup.md) / P05-05 | AC-NFR-011 | `src/db/backup.test.ts` file-backed SQLite integration; P12-02/P12-05 recovery and 100,000-event performance remain pending | SPECIFIED / IMPLEMENTED / REGRESSION_VALIDATION_PENDING |
| RQ-027 | NFR-011/012                                        | [DOC-0017](../design/UI_DESIGN.md) / P06-01、P06-02; P06                                                       | AC-NFR-016–020                                   | P12-03 E2E/accessibility                            | SPECIFIED / IMPLEMENTATION_PENDING          |
| RQ-028 | FR-Research-011、FR-Trade-013、NFR-003/010         | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02、P04、P07、P08、P09、P10；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[DOC-0036](../research/data-sources.md) / P04-03、P07-04 / #51；[DOC-0017](../design/UI_DESIGN.md) / P06-02（缺失数据展示） | AC-RES-010/017、AC-TRD-019、AC-NFR-013–015 | P07-04 mocked SEC/BOJ/BLS/Fed collectors, request audit, source hash/version; live source availability/schema NOT_VERIFIED; P12-03 E2E、P12-04 quant audit | SPECIFIED / IMPLEMENTATION_PENDING |
| RQ-029 | NFR-013                                            | [WORKFLOW_STATE.md](../design/WORKFLOW_STATE.md) / P03-05；P00-04、P08-05 | AC-NFR-021 | P12-05 security/recovery regression | IMPLEMENTED / REGRESSION_VALIDATION_PENDING |
| RQ-030 | FR-Research-012、NFR-011                           | P06、P08-04                                               | AC-RES-018、AC-NFR-016/017                       | P12-03 E2E                                          | SPECIFIED / IMPLEMENTATION_PENDING          |
| RQ-031 | NFR-001/008                                        | 不实现多用户、云同步、付费结算或真实交易；[THREAT_MODEL.md](../design/THREAT_MODEL.md) / P02-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02 | AC-NFR-002/012；P12-05 endpoint/dependency audit | P12-05 security、P13-03 release audit | OUT_OF_SCOPE |

## FR-Research 明细矩阵

| FR              | 设计责任               | 验收编号               | 后续验证阶段  | 状态                               |
| --------------- | ---------------------- | ---------------------- | ------------- | ---------------------------------- |
| FR-Research-001 | [DOC-0038](../design/DOMAIN_PRIMITIVES.md) / P05-02（当地日期映射）；P02-02、P07-01；[SCHEDULER.md](../design/SCHEDULER.md) / P03-05 | AC-RES-001–006 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-002 | [SCHEDULER.md](../design/SCHEDULER.md) / P03-05；P07-01、P11-02 | AC-RES-001–006 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-003 | [SCHEDULER.md](../design/SCHEDULER.md) / P03-05；[DOC-0017](../design/UI_DESIGN.md) / P06-03（显示已记录的重要性依据；不代替重大性裁定）；P08-03、P11-03 | AC-RES-007–012/022 | P06-03 UI projection; P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-004 | [SCHEDULER.md](../design/SCHEDULER.md) / P03-05；[DOC-0017](../design/UI_DESIGN.md) / P06-03（事件 ID 分组、修订与发现时间展示）；P08-03、P11-03 | AC-RES-008/009/012 | P06-03 repository/UI tests; P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-005 | [SCHEDULER.md](../design/SCHEDULER.md) / P03-05；[DOC-0017](../design/UI_DESIGN.md) / P06-03（无扫描/通知决策时不推断通知资格）；P08-03、P11-03 | AC-RES-007/012 | P06-03 UI projection; P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-006 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02、P05-04 / #40；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-04；[SCHEDULER.md](../design/SCHEDULER.md) / P03-05；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[DOC-0036](../research/data-sources.md) / P04-03；[DOC-0017](../design/UI_DESIGN.md) / P06-02/03（行情及事件来源、时间和证据字段展示）；P07 | AC-RES-011/022 | P05-04 file-backed source/event repository tests; P06-03 UI tests; P12-02/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-007 | [DOC-0017](../design/UI_DESIGN.md) / P06-04（报告历史 UI）；P08-04、P11-04 | AC-RES-013/014/021 | P06-04 reports UI projection tests；P12-03 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-008 | [AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03、P08；[DOC-0017](../design/UI_DESIGN.md) / P06-04（候选与风控意见 UI） | AC-RES-015/020/023 | P06-04 reports UI projection tests；P12-03/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-009 | [DOC-0017](../design/UI_DESIGN.md) / P06-04（审计历史 UI）；P08-04、P11-04 | AC-RES-019/023 | P06-04 reports UI projection tests；P12-03/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-010 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03、P08；[DOC-0036](../research/data-sources.md) / P04-03；[DOC-0017](../design/UI_DESIGN.md) / P06-02/03（行情与事件时间/来源展示） | AC-RES-010/011/017/022 | P06-03 UI tests; P12-02/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-011 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03、P04、P08；[DOC-0036](../research/data-sources.md) / P04-03；[DOC-0017](../design/UI_DESIGN.md) / P06-02/03（行情及事件降级状态展示） | AC-RES-010/017 | P06-03 UI tests; P12-03/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Research-012 | P06、P08-04            | AC-RES-018             | P12-03        | SPECIFIED / IMPLEMENTATION_PENDING |

## FR-Trade 明细矩阵

| FR           | 设计责任                 | 验收编号                   | 后续验证阶段  | 状态                               |
| ------------ | ------------------------ | -------------------------- | ------------- | ---------------------------------- |
| FR-Trade-001 | [AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；P10 | AC-TRD-004/013 | P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-002 | [AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；P03-03、P10 | AC-TRD-004 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-003 | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10 | AC-TRD-003/009 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-004 | [DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-01；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10；[DOC-0017](../design/UI_DESIGN.md) / P06-05 | AC-TRD-001/002 | P05-01 `src/db/db.test.ts`、P06-05 account state tests、P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-005 | [DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10 | AC-TRD-005–007 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-006 | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10 | AC-TRD-005/008/010 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-007 | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10 | AC-TRD-007 | P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-008 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02、P04、P10；[DOC-0036](../research/data-sources.md) / P04-03；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03；[DOC-0017](../design/UI_DESIGN.md) / P06-05 | AC-TRD-006/010/011/015/017 | P06-05 NOT_VERIFIED cost/data states；P12-01/P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-009 | [API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03、P10；[DOC-0017](../design/UI_DESIGN.md) / P06-05 | AC-TRD-013/015 | P06-05 disabled order action test；P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-010 | [DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01、P05-01；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03；[DOC-0017](../design/UI_DESIGN.md) / P06-05；P10 | AC-TRD-014 | P05-01 account-opening transaction test、P06-05 repository/UI tests、P12-02 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-011 | [API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[BACKTEST_ENGINE.md](../design/BACKTEST_ENGINE.md) / P03-04；[DOC-0017](../design/UI_DESIGN.md) / P06-05；P09 | AC-TRD-016/017 | P06-05 BacktestsPage tests；P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-012 | [BACKTEST_ENGINE.md](../design/BACKTEST_ENGINE.md) / P03-04；[DOC-0017](../design/UI_DESIGN.md) / P06-05；P09-06 | AC-TRD-018 | P06-05 BacktestsPage tests；P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| FR-Trade-013 | [AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03、P02-04、P04、P07/P08/P10；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[DOC-0017](../design/UI_DESIGN.md) / P06-05 | AC-TRD-019 | P06-05 offline/not-verified UI tests；P12-03/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |

## NFR 明细矩阵

| NFR     | 设计责任                      | 验收编号           | 后续验证阶段  | 状态                                        |
| ------- | ----------------------------- | ------------------ | ------------- | ------------------------------------------- |
| NFR-001 | [ARCHITECTURE.md](../design/ARCHITECTURE.md) / P02-01；[THREAT_MODEL.md](../design/THREAT_MODEL.md) / P02-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；P06 | AC-NFR-001/002 | P12-03/P12-05 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-002 | P02/P05/P06                   | AC-NFR-003/004     | P12-06        | SPECIFIED / IMPLEMENTATION_PENDING          |
| NFR-003 | [ARCHITECTURE.md](../design/ARCHITECTURE.md) / P02-01；[FAILURE_MODES.md](../design/FAILURE_MODES.md) / P02-04；[DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[AI_WORKFLOW.md](../design/AI_WORKFLOW.md) / P02-03、P04、P07/P08/P09/P10 | AC-NFR-005/013/014 | P12-02/P12-03 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-004 | [FAILURE_MODES.md](../design/FAILURE_MODES.md) / P02-04；[SCHEDULER.md](../design/SCHEDULER.md) / P03-05；P04、P08-01、P11 | AC-NFR-005/006 | P04-01 bare SDK observed 37 loopback requests; P08-01 provider request/stream retries set to 0 and WebSocket fallback disabled; disconnect, HTTP 429, and flat SSE error each made 1 loopback request; SDK exposes no universal request counter; P12-02 integration and auth-refresh behavior pending | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-005 | [FAILURE_MODES.md](../design/FAILURE_MODES.md) / P02-04/P11-01；[DB_SCHEMA.md](../design/DB_SCHEMA.md) / P03-01/P11-01；[WORKFLOW_STATE.md](../design/WORKFLOW_STATE.md) / P03-05/P11-01；[ARCHITECTURE.md](../design/ARCHITECTURE.md) / P04-04/P05/P10/P11；[DOC-0037](../research/p04-04-worker-runtime-findings.md) / P04-04 PoC | AC-NFR-007–009 | P04-04 browser-close PoC; P11-01 SQLite queue, single-worker lease, restart fencing, timeout/cancel Worker Thread tests; P12-02/P12-05 remain | SPECIFIED / IMPLEMENTED_PARTIAL |
| NFR-006 | [RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03；P05/P08/P10 | AC-NFR-010 | P12-04/P12-05 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-007 | [ADR-0001](../decisions/0001-sqlite-system-of-record.md) / P02-04；[FAILURE_MODES.md](../design/FAILURE_MODES.md)；[DOC-0013](../design/DB_SCHEMA.md) / P03-01、P05-04 / #40、P05-05 / #41；[DOC-0009](../design/API_CONTRACTS.md) / P06-06；[DOC-0035](../research/p04-02-sqlite-drizzle-findings.md) / P04-02 PoC；[DOC-0039](../operations/backup.md) / P06-06 UI entry | AC-NFR-011 | P05-05 `src/db/backup.test.ts` (5 file-backed SQLite tests); P06-06 local-origin API and Playwright backup success/failure; P12-02/P12-05 crash and 100,000-event performance recovery pending | SPECIFIED / IMPLEMENTED / REGRESSION_VALIDATION_PENDING |
| NFR-008 | [THREAT_MODEL.md](../design/THREAT_MODEL.md) / P02-04；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02、P06-06；[ARCHITECTURE.md](../design/ARCHITECTURE.md) / P05、P08-05；[DOC-0017](../design/UI_DESIGN.md) / P06-06 credential-safe settings and backup response | AC-NFR-002/012/022 | P06-06 route and Playwright secret-sentinel checks; P12-05 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-009 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02、P03、P07/P08/P09/P10；[DOC-0036](../research/data-sources.md) / P04-03；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03 | AC-NFR-013/014 | P12-02/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-010 | [DATA_PROVENANCE.md](../design/DATA_PROVENANCE.md) / P02-02、P04、P06/P08/P09/P10；[DOC-0036](../research/data-sources.md) / P04-03；[API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[RISK_ENGINE.md](../design/RISK_ENGINE.md) / P03-03 | AC-NFR-015 | P12-03/P12-04 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-011 | [API_CONTRACTS.md](../design/API_CONTRACTS.md) / P03-02；[DOC-0017](../design/UI_DESIGN.md) / P06-01、P06-02、P06-05；P06/P08 | AC-NFR-016/017 | P12-03 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-012 | [DOC-0017](../design/UI_DESIGN.md) / P06-01、P06-02、P06-05、P06-06；P06 | AC-NFR-018–020 | P06-05 BacktestsPage and P06-06 Settings/Tasks Playwright narrow-screen, keyboard and status announcement checks；P12-03 | SPECIFIED / IMPLEMENTATION_PENDING |
| NFR-013 | [WORKFLOW_STATE.md](../design/WORKFLOW_STATE.md) / P03-05；P00-04、P08-05 | AC-NFR-021 | P12-05 | IMPLEMENTED / REGRESSION_VALIDATION_PENDING |

## 用户用例覆盖

| 用例  | 需求/验收入口                                                              | 后续端到端/集成验证 |
| ----- | -------------------------------------------------------------------------- | ------------------- |
| UC-01 | RQ-001/025/027/028；AC-NFR-001/002/012/013/016–020                         | P12-03/P12-05       |
| UC-02 | RQ-003/004/010/011/012；AC-RES-013/014/021/022、AC-NFR-013/014/016/017/020 | P12-03              |
| UC-03 | RQ-005/006/010/024；AC-RES-001–012/022、AC-NFR-005–008/014                 | P12-02/P12-03       |
| UC-04 | RQ-007/009/012/014/019；AC-RES-015/016/020/023、AC-TRD-018                 | P12-03/P12-04       |
| UC-05 | RQ-008/010/011；AC-RES-019/022                                             | P12-03/P12-04       |
| UC-06 | RQ-010/011/030；AC-RES-011/018/022、AC-NFR-014/016/017/022                 | P12-02/P12-03       |
| UC-07 | RQ-002/015–022；AC-TRD-001–015/019、AC-NFR-009/010/013–015                 | P12-01/P12-02       |
| UC-08 | RQ-011/013/014/022/028；AC-TRD-016–019、AC-NFR-013–015                     | P12-04              |
| UC-09 | RQ-023–025/029；AC-NFR-005–010/012/021/022                                 | P12-02/P12-05       |
| UC-10 | RQ-021/026；AC-TRD-014、AC-NFR-009–011                                     | P12-02/P12-05       |

## 完成门禁

1. P02/P03 设计交付物应链接到本矩阵中的设计责任列，不得将尚未创建的文档写成已完成。
2. P04/P05/P06/P07/P08/P09/P10/P11 按对应 AC 增加实现和可重复测试；测试日志必须带真实运行命令、退出码和样本/环境。
3. P12 对适用 AC 记录 PASS/FAIL/BLOCKED_EXTERNAL/NOT_RUN；没有日志时保持 `NOT_RUN`。Fixture 只验证演示路径，不替代真实来源联通。
4. P13 交付前核对 OUT 范围没有误加登录、用户管理、云同步、付费结算或真实交易能力。
