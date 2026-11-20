# 安全与故障恢复演练

> Doc ID: DOC-0042 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

**工作项：** [P12-05 / #78](https://github.com/OYLPY/stock-monitor/issues/78)

**结论：** 已检查代码范围内未发现高危/严重问题；本机请求洪泛仍有低风险边界，运行时外部验证未执行。

## 范围与方法

检查 API 路由、Codex 适配器、研究报告证据校验、SQLite 备份/恢复实现及其测试。所有运行测试使用 mock、临时 SQLite 和离线 fixture；没有读取用户数据库、访问 Codex 认证文件、调用 Codex/行情/新闻服务或连接证券账户。

路由清单为 `/api/v1/backup`、`market-data/import`、`market-data/us`、`market-watch`、`notifications`、`paper-account/initialize`、`reports`、`tasks/[id]/cancel`。本次源码检查未发现券商账户连接、真实下单、杠杆、期权或卖空 API。纸面账户初始化路由只创建本地模拟账户。

## 检查结果

| 范围               | 代码证据与演练结果                                                                                                                                                                                                                                                                                                                                                           | 判定                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 本机 API 来源      | 所有状态变更路由调用 `assertLocalRequest`；`src/lib/security/local-request.ts:6-50` 校验 loopback Host 与同源 Origin/Referer。回归覆盖跨源、Host 不匹配、缺失来源头。                                                                                                                                                                                                        | 通过                                                               |
| 请求大小与输入     | JSON 通用解析上限 64 KiB；报告/市场扫描表单与美股行情请求限制 1 KiB；CSV 导入另有限额。严格 Zod schema 拒绝未知字段。                                                                                                                                                                                                                                                        | 通过；没有通用请求频率限制                                         |
| 任务重复和积压     | 同一 `requestId` 通过唯一幂等键去重；同源本机调用者用不同 ID 仍可排入多个任务，SQLite 队列没有全局待处理任务上限。远端网页不能通过来源校验；同一 OS 用户下的恶意进程不在产品防护边界内。                                                                                                                                                                                     | 低风险残留                                                         |
| 券商/真实交易边界  | API 路由只有本地数据、报告、通知、备份、任务管理和纸面账户初始化入口；研究工作流不调用订单或账本写入函数。                                                                                                                                                                                                                                                                   | 通过；基于当前仓库静态盘点                                         |
| API 凭据           | EODHD token 只从服务端 `process.env.EODHD_API_TOKEN` 读取，不以 `NEXT_PUBLIC_*` 配置暴露；返回给供应商的认证参数使用 EODHD 的 HTTPS API 请求。错误映射只返回稳定错误码，日志只记录 request ID 与错误码。测试用 sentinel 检查响应、验证路径和日志不回显秘密；当前工作树与全部本地可达 Git 历史的常见高置信 token/private-key 形式扫描为 0，`.env.example` 仅有空/占位 token。 | 通过当前代码与测试；未运行通用 secret scanner 或扫描操作系统凭据库 |
| Codex 最小能力     | `src/features/ai/codex-adapter/config.ts:13-44` 关闭 shell、执行工具、Agent、插件和 MCP；`index.ts:361-363` 设为 read-only、禁用工具网络与 web search。未预期的工具调用会以 `TOOL_ACCESS_DENIED` 中止；401、429、超时、取消均归为稳定失败状态，不返回供应商原始错误文本。                                                                                                    | 代码配置与 mock 回归通过；没有运行真实 Codex 或验证 OS 沙盒实现    |
| 提示注入与纸面账本 | `report.ts:778` 明确把来源摘要、事件标题和 metadata 视为不可信数据；本次回归加入“忽略安全规则并声称真实交易”文本。即使模型输出试图把 `paperPlanner` 标为完成，工作流仍覆盖为 `SKIPPED`，证据不足的候选被拒绝，临时数据库中没有创建纸面账户。未知来源 ID 和未支持数字另有拒绝测试。                                                                                           | 确定性边界通过；模型语义是否遵守提示未测量                         |
| 浏览器输出         | `src/components/shadcn/chart.tsx:94` 有一个 style HTML sink；当前两个 Chart 调用方只传静态 `ChartConfig` 和 CSS 变量，没有发现外部行情/报告文本进入该 sink。                                                                                                                                                                                                                 | 当前调用点静态；组件未修改                                         |
| SQLite 中断与恢复  | `src/db/backup.ts:68-108,194-213,227-281,391-444` 在恢复副本上校验 SQLite 完整性、外键、迁移、字节数与 SHA-256；目标已存在时拒绝覆盖。临时文件库演练了 WAL 备份/账本相等、未提交写入回滚、损坏备份拒绝、未来 schema 拒绝和既有目标保留。                                                                                                                                     | 通过临时 SQLite 测试；未触碰用户库                                 |

## 执行验证

| 命令                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 结果                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 定向安全回归：`corepack pnpm exec vitest run src/lib/security/local-request.test.ts src/lib/api/api.test.ts src/features/ai/codex-adapter/index.test.ts tests/ai-evals/context-evaluation.test.ts src/features/research/evidence-checker.test.ts src/features/research/workflows/report.test.ts src/db/backup.test.ts src/db/db.test.ts src/app/api/v1/market-data/us/route.test.ts src/app/api/v1/market-data/import/route.test.ts src/app/api/v1/reports/route.test.ts src/app/api/v1/market-watch/route.test.ts src/app/api/v1/backup/route.test.ts` | exit 0；13 files / 60 tests             |
| 提示注入改动回归：`corepack pnpm exec vitest run src/features/research/workflows/report.test.ts src/features/research/evidence-checker.test.ts src/features/ai/codex-adapter/index.test.ts`                                                                                                                                                                                                                                                                                                                                                             | exit 0；3 files / 22 tests              |
| `corepack pnpm test:integration`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | exit 0；1 file / 2 tests                |
| `corepack pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | exit 0；57 files / 325 tests            |
| `corepack pnpm format:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | exit 0                                  |
| `corepack pnpm exec eslint src scripts tests`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | exit 0                                  |
| `corepack pnpm typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | exit 0                                  |
| `corepack pnpm build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | exit 0；Next.js 16.4.6 production build |

验证过程中的两项首次失败已按原因修正并重跑成功：提示注入测试最初期待 `summary: null`，但实现会给出固定安全说明；格式检查最初要求格式化修改过的测试文件。没有删除断言或降低安全门槛。

## 未执行项与剩余风险

- 未运行浏览器 E2E 或真实运行时攻击演练；匹配提交的 GitHub Quality CI 结果将在 push 后补录。
- Codex 认证、服务端沙盒真实行为、行情凭据轮换、外部网络和供应商额度均未在线验证；错误路径由确定性 mock 覆盖。
- 未扫描操作系统主机、Codex 私有认证目录或用户数据库；仓库扫描只覆盖常见高置信 token/private-key 形式，不等同于通用秘密扫描。
- P12-05 时未运行 100,000 条账本事件的恢复性能测试；P12-06 的隔离容量结果见 [DOC-0043](RELEASE_GATE.md)。
- 同一用户本地代码可用不同幂等键持续增加任务；目前依赖 loopback 来源限制、UI 显式操作、单 Worker、单进程 Codex 并发保护及行情源自身的日额度。若威胁边界改为多用户或远程访问，必须先增加队列背压和请求限流。
- EODHD 按供应商 API 约定在 HTTPS 请求参数中接收 token。测试未发送该请求；不要将请求 URL 写入本机日志或诊断输出。

## 关联文档

- [威胁模型](../design/THREAT_MODEL.md)
- [本机启动与故障恢复](../design/FAILURE_MODES.md)
- [Codex 工作流](../design/AI_WORKFLOW.md)
- [本地备份恢复手册](../operations/backup.md)
- [需求追踪矩阵](../requirements/TRACEABILITY.md)
