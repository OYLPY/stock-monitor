# P04-04：独立 Worker、浏览器关闭与恢复 PoC

> Doc ID: DOC-0037 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 问题与 as-of 日期

**核验时点：2026-11-16。**验证本地持久任务与浏览器页面/Next.js 服务的生命周期分离、Node Worker 在进程中断后的状态恢复与幂等，并比较 Windows/macOS 用户级启动选项。对应 GitHub Issue [#36](https://github.com/OYLPY/stock-monitor/issues/36)。本 PoC 不代表生产调度器实现或硬件持续运行承诺。

## 方法与筛选标准

- 使用 Node.js 子进程、SQLite、共享的 `store.ts`、独立 Worker loop 和隔离 Next.js Route Handler；任务与 effect ledger 写入临时数据库。
- 在认领前、认领提交后、副作用记录提交后、最终状态提交后终止 Worker，再重启并检查状态及 effect 数量；另检查重复 API 请求、过期 lease fencing 和错过盘中窗口。
- 用实际 Next.js 页面提交任务，关闭浏览器标签页后停止 Next.js 服务，再观察 Worker 心跳、任务状态和本地 effect 数量。
- 仅读取 Microsoft 与 Apple 官方启动文档；未注册系统任务/服务。系统睡眠、关机、macOS 行为均不从时间模拟或 Windows 测试推断。
- 不调用市场/新闻 API，不读取凭据，不发起外部请求；本 PoC 没有真实交易、通知或行情副作用。

## 来源（直接链接、访问日期、许可/限制）

| 来源                                                                                                                                                                                        | 适用证据                                                                                                               | 访问日期与限制                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [Microsoft：Starting an Executable When a User Logs On](https://learn.microsoft.com/en-us/windows/win32/taskschd/starting-an-executable-when-a-user-logs-on)                                | Task Scheduler 可用 logon trigger 在指定用户登录时启动可执行动作。                                                     | 2026-11-16；仅核对官方文档，未注册或运行登录任务。 |
| [Microsoft：LogonTrigger object](https://learn.microsoft.com/en-us/windows/win32/taskschd/logontrigger)                                                                                     | 登录触发器及指定用户的调度语义。                                                                                       | 2026-11-16；不代表本机任务计划配置已测试。         |
| [Apple：Updating helper executables from earlier versions of macOS](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos) | 区分 LoginItem、LaunchAgent、LaunchDaemon；macOS 13+ 的 `SMAppService` 提供注册和授权状态，用户可在 Login Items 管理。 | 2026-11-16；官方文档研究，未在 macOS 实机验证。    |

## 发现与相反证据

### 浏览器与 Worker 生命周期

实际浏览器表单收到 `202`，任务为 `PENDING`。标签页关闭后 harness 停止 Next.js 服务；Worker 仍存活，心跳时间晚于关闭时间，任务变为 `DONE`，且任务只写入 1 条 effect。真实运行字段和时间戳见 [`actual-run-2026-11-16.jsonl`](../../poc/worker/actual-run-2026-11-16.jsonl)。这证明该 PoC 的持久队列消费者不依赖页面或 Next.js 进程继续运行。

API 与 Next Route Handler 共享 SQLite/store 模块。重复请求返回既有任务，输入校验拒绝非法幂等键。该结果仅适用于本地任务表和 effect ledger；effect 是事务性 SQLite 记录，不是对远端通知、网络调用或模拟成交的 exactly-once 证明。

### 进程中断、幂等与错过窗口

故障注入在四个已持久化边界终止并重启 Worker；所有场景最终至多写入 1 条 effect，已完成任务不再重复执行。旧 lease/claim generation 的 Worker 无法提交 effect，当前 lease 可完成任务。重复 API 请求不新增任务。

测试通过前后两个时间戳模拟 4,000 ms runtime gap（阈值为 3,000 ms）；落在缺失区间的实时窗口记录为 `SKIPPED / MISSED_WINDOW`。这是可重复的状态机测试，不是设备睡眠、关机或供电中断实验。真实硬件睡眠/关机恢复为 `NOT_TESTED`。

### Windows 与 macOS 启动选项

| 系统    | 官方能力                                                                                                                                                                    | 本项目候选方案与限制                                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | Task Scheduler 的 logon trigger 可在指定用户登录后运行程序。                                                                                                                | 后续安装/运维阶段优先评估当前用户的登录触发任务；本 PoC 未创建任务，也未验证系统启动、睡眠唤醒或权限策略。                                                                  |
| macOS   | Service Management 支持 LoginItem、LaunchAgent 与 LaunchDaemon；macOS 13+ 提供 `SMAppService` 注册和授权状态，用户可在 Login Items 控制。系统级 LaunchDaemon 涉及更高权限。 | 后续打包阶段优先评估用户级 LoginItem/LaunchAgent，说明用途并尊重用户授权；不建议为本地工具默认安装系统级 daemon。macOS、签名打包、首次授权和用户关闭开关均为 `NOT_TESTED`。 |

## 结论、置信边界与待验证项

- **已核实（PoC 范围）：**关闭浏览器标签页并停止 Next.js 服务后，独立 Worker 仍推进持久任务；四个进程终止点恢复后本地 effect 不重复；错过窗口的状态可被显式标记。
- **未核实：**真实机器睡眠/关机、操作系统启动注册、macOS 行为、生产数据库集成、远程通知/行情/交易副作用语义。不得据此宣称设备离线时仍在线监控。
- **实现状态：**P04-04 技术可行性 PoC；生产 Worker、系统调度安装和运行态 UI 仍待 P05/P11 阶段设计与验收。

## 决策影响与下一步

保留独立 Worker 与持久化任务消费者的架构方向；恢复时必须依据本地时间窗、心跳和持久状态将错过的实时任务标记为跳过，不能补报为实时监控。P05 建立应用级数据库/仓储；P11 再决定生产调度、用户级启动、取消和告警边界。运行命令及复现步骤见 [`poc/worker/README.md`](../../poc/worker/README.md)。
