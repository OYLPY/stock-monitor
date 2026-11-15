# P04-01：Codex TypeScript SDK 与本地 CLI 集成核验

> Doc ID: DOC-0034 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

**检索日期：2026-11-16**

## 问题与 as-of 日期

核验本项目安装的 Codex TypeScript SDK 如何启动 CLI、流式返回事件、继承本地认证和限制文件权限；检查失败、限额与取消的公开语义，并评估 SDK 0.169.0 与本机 Codex CLI 0.149.1 的版本差异。

## 方法与筛选标准

- 优先使用 OpenAI Codex 官方文档、OpenAI 的 Codex SDK 仓库和已安装官方 npm 包；对本机版本相关结论，以当前安装包的 README、类型声明、构建产物和 package metadata 为准。
- 对照已安装包、版本化 CLI 与官方 `rust-v0.169.0` 源码；实际调用只使用固定无敏感内容提示、空临时工作目录与脱敏事件摘要。
- `success` 使用本机保存的 CLI 登录做一次真实调用；`no-auth` 使用空临时 `CODEX_HOME`；`offline` 将 API base URL 指向只绑定 loopback 的本地断连端点并统计请求数。
- 将文档/代码明确支持的内容标为“已核实”；将多项事实组合后得到的预期行为标为“推断”；官方资料未保证的行为明确列为 `NOT_VERIFIED`。

本机观察结果：`pnpm list @openai/codex-sdk --depth 0` 显示 SDK 0.169.0；全局 `codex --version` 为 0.149.1，SDK 默认打包 CLI 为 0.169.0。真实成功调用在 6,315 ms 完成并通过 JSON Schema；空登录状态经 CLI 确认为 `not_logged_in`，SDK turn 以脱敏的网络错误结束；最终隔离裸离线模式使用临时 `CODEX_HOME` 和非敏感占位 key，31,534 ms 后失败，端点收到 37 次 `/v1/responses` 请求，即使 SDK 传入 `features.unbounded_connection_retries=false`。候选宿主策略在收到首个流式网络错误后 abort，1,722 ms 内以 3 次请求停止。本地 429 fixture 收到两次 `/v1/responses` 请求，SDK 错误仍归为 `network_unavailable`。所有模式工作目录均保持为空。脱敏摘要见 `poc/codex/actual-run-2026-11-16.jsonl`；该文件也保留了较早的探索性运行结果。

## 来源（直接链接、访问日期、许可/限制）

| 来源                                                                                                                                                                                                                 | 适用证据                                                                     | 访问日期与边界                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [OpenAI Codex SDK 文档](https://learn.chatgpt.com/docs/codex-sdk)                                                                                                                                                    | TypeScript SDK 用于启动、继续和恢复本地线程；README、配置覆盖与 SDK/CLI 定位 | 2026-11-15；没有声明对任意外部 CLI 版本的兼容范围                   |
| [OpenAI Codex TypeScript SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)                                                                                                             | SDK 包装 @openai/codex CLI、JSONL、run/runStreamed、环境传递和配置项         | 2026-11-15；main 分支可能变化，本机 0.169.0 安装包用于版本特定核对  |
| [OpenAI Codex SDK thread.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts) 与 [exec.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts)                              | 线程事件、子进程启动、配置参数转发和失败处理实现                             | 2026-11-15；本机 dist 类型声明/构建产物是当前安装版本的直接观察证据 |
| [@openai/codex-sdk 0.169.0 发布包](https://www.npmjs.com/package/@openai/codex-sdk/v/0.169.0) 与 [@openai/codex 0.169.0 CLI 包](https://www.npmjs.com/package/@openai/codex/v/0.169.0)                               | 精确发布版本和包来源                                                         | 2026-11-15；本地 package metadata 已核对，未从 npm 重新安装         |
| [Codex 环境变量](https://learn.chatgpt.com/docs/config-file/environment-variables)                                                                                                                                   | CODEX_HOME、CODEX_API_KEY 和 CODEX_ACCESS_TOKEN 的用途                       | 2026-11-15；不代表已验证当前用户的认证可用性                        |
| [Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)                                                                                                                                              | codex exec 默认权限、JSONL 事件和已保存 CLI 登录的使用说明                   | 2026-11-15；具体 SDK 调用仍需单独验证                               |
| [Codex 0.169.0 重试实现](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/core/src/responses_retry.rs) 与 [feature 定义](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/features/src/lib.rs) | 连接失败的采样 turn 在 feature 开启时循环重试；标记了 feature 默认值         | 2026-11-16；版本 tag 与本机 SDK 随附 CLI 一致                       |
| [Codex 0.169.0 provider retry 配置](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/model-provider-info/src/lib.rs)                                                                                      | provider 默认重试次数与可配置字段                                            | 2026-11-16；内置 `openai` 的覆盖限制另以本机 CLI 实测为准           |

## 发现与相反证据

### 运行模型与版本

官方 SDK README 说明，TypeScript SDK 包装 @openai/codex CLI，并通过 stdin/stdout 交换 JSONL；它不是直接调用一个与 CLI 无关的远端 HTTP 客户端。SDK 文档将 TypeScript library 描述为可在本机启动、继续和恢复线程。

本机 0.169.0 的 package metadata 将 @openai/codex 固定为精确版本 0.169.0，并列出同版本的平台包。SDK 构建代码默认通过该依赖解析平台二进制并启动它；只有传入 codexPathOverride 才改用指定可执行文件。因此，在未设置 override 的默认路径下，显示为 0.149.1 的全局 codex 命令不是 SDK 的 CLI 运行时。此版本隔离结论由本机包 metadata 和实现共同支持。

OpenAI 文档没有给出 SDK 与任意外置 CLI 的兼容矩阵。若把 codexPathOverride 指向 0.149.1，SDK 0.169.0 会向 CLI 传入其 JSONL、线程及配置参数；该 CLI 对参数、事件 schema 和失败语义的兼容性为 `NOT_VERIFIED`。除非 P04 明确需要共享全局 CLI，否则应使用 SDK 默认的版本化运行时。

### 本地认证来源与环境继承

OpenAI 的环境变量文档说明，CODEX_HOME 保存 Codex 的配置、认证、日志和会话状态，默认是用户 Codex 状态目录；CODEX_API_KEY 可用于 TypeScript SDK，CODEX_ACCESS_TOKEN 用于 CLI、app-server 和受信任自动化。非交互模式文档说明 codex exec 默认重用已保存的 CLI 认证。

本机 SDK README 和实现说明：默认把 Node.js 的 process.env 传给 CLI；若传入 Codex 的 env 选项，SDK 不再继承原进程环境，而使用提供的环境变量；Codex 的 apiKey 选项会设置子进程的 CODEX_API_KEY。因此，默认同一操作系统用户、未替换环境且未将 CODEX_HOME 指到其他目录时，SDK 启动的 CLI 预期可找到同一份已保存 CLI 登录状态。这是根据 SDK 子进程模型、环境变量和 CLI 登录说明得到的推断，不是本次实际 SDK 登录验证。

`env` 是整体环境覆盖，不是增量追加。显式传入时，应用须有意保留运行 CLI 所需的环境项及预期 CODEX_HOME；不得假设 SDK 会自动合并登录状态。对不可信仓库代码运行代理时，也不得把长期密钥无差别暴露给任务进程；OpenAI 的自动化文档建议仅为需要它的 Codex 调用提供 CODEX_API_KEY。

### 流式事件

本机 0.169.0 类型声明将 runStreamed 定义为返回带 AsyncGenerator 的结果；SDK README 说明 run() 缓冲整轮事件，而 runStreamed() 可逐个读取结构化事件。类型联合包含 thread.started、turn.started、turn.completed、turn.failed、item.started、item.updated、item.completed 和 error。完成事件含 token usage，thread.started 提供可用于后续恢复的 thread_id。

SDK 的 run() 汇总已完成 items、finalResponse 和 usage；实现会把 turn.failed 转为普通 Error。runStreamed() 则让调用者处理事件流。建议 P04 将事件类型映射成明确的运行状态，并区分 turn.failed、流级 error、子进程异常和成功完成；不能只将“收到了文字”视为整轮成功。

### 沙箱与文件权限

本机 ThreadOptions 暴露 sandboxMode、workingDirectory、additionalDirectories 和 networkAccessEnabled。sandboxMode 的 SDK 类型包括 read-only、workspace-write、danger-full-access；SDK 将其映射到 CLI 参数。官方 codex exec 文档说明默认只读，workspace-write 允许工作区及配置可写根目录内的编辑，danger-full-access 移除文件系统沙箱限制。

建议每次创建线程显式设置 workingDirectory 和最小 sandboxMode：研究/审查任务用 read-only，需要代码修改时才用 workspace-write。不要将 danger-full-access 用作本地工具默认值。审批策略与沙箱权限是不同维度；官方文档说明禁止询问审批不会自动授予无限文件权限。SDK 的 networkAccessEnabled 会写入 workspace-write 网络配置；其与系统策略、搜索模式的最终交互未在本项目环境中执行验证，应继续保持默认关闭，除非 P04 验收明确需要网络。

### 错误、限额与取消

- 本机类型声明为 turn.failed 和 error 事件定义 message 字段；SDK 子进程实现还会在 JSONL 解析失败、进程启动失败或非零退出时抛出普通 Error，并附带进程退出信息/标准错误。未发现稳定的 SDK 专用错误类或完整错误码映射，调用侧需要同时处理事件和 Promise rejection。
- TurnOptions 的 signal 接受 AbortSignal；SDK 将 signal 传给启动 CLI 的子进程。接口声明称其用于取消 turn。官方资料没有保证取消后远端请求何时停止、部分输出是否可恢复、thread 是否可继续，或已写入文件会回滚；这些均为 `NOT_VERIFIED`。设计上应将取消作为可能留下部分产物的中断，之后检查工作区差异，而不是当作事务回滚。
- Codex 0.169.0 将 `unbounded_connection_retries` 默认设为开启；对外部采样 turn 的连接失败会持续重试，间隔从 5 秒指数增长并封顶 60 秒。最终隔离测试将 `features.unbounded_connection_retries=false` 传给 SDK 后，loopback 端点仍记录 37 次 `/v1/responses` 请求；CLI 自身 `features list` 能显示该 override 为 false，说明参数可被解析，但实际 attempt 数仍违反任务预算。较早使用本机默认 `CODEX_HOME` 的探索性运行记录了 52 次，不作为最终隔离证据。
- 对裸 SDK 调用，最终隔离离线测试仍记录 37 次 `/v1/responses` 请求，超过 NFR-004 每任务 3 次上限。候选宿主策略在收到首个 `error` 流事件且分类为网络错误后立即通过 AbortSignal 中止 turn；同一离线故障下记录 3 次请求、PoC 退出码 0、工作目录为空。这只验证了该断连路径的宿主取消，不证明其他错误类型、HTTP API、账号额度或所有竞争条件都满足同一上限。
- Codex 0.169.0 的内置 OpenAI provider 默认最多 4 次请求重试、5 次流重连。尝试以 `model_providers.openai.stream_max_retries=2` 覆盖时，CLI 报告 `openai` 是保留的内置 provider ID，禁止以该方式覆盖；因此尚未验证一种能同时保留默认本地登录且将 SDK 任务总尝试数限制为 3 的配置。
- `simulated-429` 只向 loopback 返回带 `rate_limit_error` 的本地 fixture，不代表真实账户限额。观察到两次 `/v1/responses` 请求，SDK 最终错误分类为 `network_unavailable`；不能据此声称真实 429 一定如此，但该 SDK 路径未提供满足 NFR 的可见单次 quota 处理证据。
- 完成事件返回 input、cached input、cache write、output 和 reasoning token 计数。公开 SDK 类型没有单次运行的最大费用/令牌参数；本次核验的官方 TypeScript SDK 文档也没有给出固定的请求、速率或套餐配额数字。因此具体账号/项目限额、达到限额时的 Codex SDK 错误形状仍为 `NOT_VERIFIED`。不要把没有发现额度数值解释为没有额度限制。

## 结论、置信边界与待验证项

**已核实：**SDK 是本地 CLI 子进程封装并使用 JSONL；当前依赖树将 SDK 与默认平台 CLI 固定在 0.169.0；真实成功调用、JSON Schema、空登录状态和无文件写入均由本机 PoC 观察。全局 CLI 0.149.1 的版本号通过只读版本命令确认。官方 tag 显示 `unbounded_connection_retries` 默认开启，内置 OpenAI provider 的重试默认值为 request 4 / stream 5。

**推断：**成功调用表明当前 Windows 用户的 SDK 默认 CLI 路径能使用本机保存的登录状态；SDK 不会因全局 CLI 为 0.149.1 而自动改用该版本。

**设计结论与未核验项：**裸 SDK 连接调用不符合 NFR-004；宿主在首个流式网络错误时取消的 PoC 在该离线场景中将请求限制为 3，P08 必须用持久化任务预算和真实 Worker 测试落实，不能依赖 feature flag 或手工 resume 重置预算。无凭据模式确认 CLI 未登录，但 SDK 只暴露通用网络错误。模拟 429 两次 loopback 请求仍归为网络错误；真实配额耗尽、auth-specific error、取消后的远端终止行为、外置 CLI 0.149.1 兼容性及跨故障条件的请求上限仍为 `NOT_VERIFIED`。

## 决策影响与下一步

1. 保留 SDK 默认版本化 CLI 和当前本地认证路径；不要以用户全局 CLI 版本推断 SDK 使用版本。
2. 线程继续显式限制工作目录、沙箱和网络；成功 PoC 是只读、无工具、无外部行情请求。
3. P08 的 Codex adapter 必须在首次流错误后立即中止当前 SDK turn、持久化并复用每任务预算；只有在 P08 验证 HTTP 429、凭据错误、权限错误和并发取消均不超出 NFR-004 后，才可将集成视为符合要求。仅设置 timeout 或依赖 CLI feature flag 不足以证明请求次数有界。
4. 将 429/费用限制、真实 auth-specific error、取消后的 CLI/远端状态列为 `NOT_VERIFIED`；不得让无凭据模式的通用 network error冒充已验证的认证错误。
5. P04-01 在本地调用 PoC 及常规工程检查通过后，仍须因 retry budget 不满足验收而保持 Issue Open；禁止将该路径描述为符合 NFR-004。
