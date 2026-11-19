# P11-06 / #91 验收记录：报告自动采集官方宏观来源

## 目标与范围

晨报、日审计和周审计在研究开始前自动采集公开官方宏观与央行来源，将可核验 sourceRecord ID 和来源状态写入报告证据；没有获许可且覆盖充分的美日股票 OHLCV 时保持零候选。工作项：[GitHub Issue #91](https://github.com/OYLPY/stock-monitor/issues/91)。

## 已实现并验证

- MORNING、DAILY_AUDIT、WEEKLY 开始研究前请求 BLS v1 CPI-U/失业率、BOJ FM08 USD/JPY FXERD04/FXERD05、Federal Reserve press RSS、BOJ RSS；只用无需 API key 的官方公开 URL。
- 来源事实先写入 SQLite disclosure/source-record 仓储；报告只接收已持久化的引用，包含 sourceRecord ID、来源角色、license 状态、采集时刻、观察期或发布时间、单位/币种摘要及 URL。
- BLS 按延迟数据处理；无数值的“-”不写为事实。BOJ 仅保留有数值且早于 Asia/Tokyo 当前日期的日线观察；不把参考汇率当可成交报价。RSS 仅保留标题、链接和可解析发布时间，不读取正文。空 Feed 不表示没有事件。
- 请求失败、限流或 schema 异常不会生成事实引用，逐源状态在报告限制中可见；没有股票 OHLCV 时 Codex 输出仍被强制为零候选。
- 新增 file-backed 集成测试覆盖关闭重开后 sourceRecord 可追溯、重复采集幂等、东京日期边界及来源失败降级；研究工作流测试覆盖已持久化引用进入提示词以及缺股票行情时零候选。

## 公开端点只读 smoke

2026-11-19 Asia/Tokyo；未注册账号、未申请 API key、未使用付费服务：

| 官方来源               | 实测请求与结果                                                                                                                                                                                             | 可用于报告的边界                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| BLS Public Data API v1 | 2026-11-19 14:38:32 JST，POST /publicAPI/v1/timeseries/data/，CUUR0000SA0 与 LNS14000000，2025–2026；HTTP 200、REQUEST_SUCCEEDED，Results.series 实际为对象；2 个序列、44 个原始观察值，42 个数值、2 个“-” | 只保留数值和观察期；没有可核实发布日期，标记 DELAYED。                      |
| BOJ FM08               | 2026-11-19 14:40:19 JST 请求 getDataCode，FXERD04/05，202501–202611；HTTP 200、STATUS=200，响应生成于 14:40:22.101+09:00；1,398 个日期槽位，每系列 244 个空值，最新非空日期 2026-11-17                     | 日期是 Asia/Tokyo 观察日；空值和当前/未来日不持久化；参考汇率不是执行报价。 |
| Federal Reserve RSS    | 2026-11-19 14:38:32 JST；HTTP 200，text/xml，14,568 bytes                                                                                                                                                  | 标题、链接和发布时间，不包含公告正文。                                      |
| Bank of Japan RSS      | 2026-11-19 14:38:32 JST；HTTP 200，application/xml; charset=UTF-8，15,633 bytes                                                                                                                            | 仅官方域名；官方 feed 内 HTTP 链接规范化为 HTTPS。                          |

详细方法与官方来源链接见 [DOC-0036 数据源调查](../../docs/research/data-sources.md) 的 P11-06 实测部分。

## 本地质量门禁

| 命令                       | 结果                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| corepack pnpm format:check | exit 0                                                                                        |
| corepack pnpm lint         | exit 0                                                                                        |
| corepack pnpm typecheck    | exit 0                                                                                        |
| corepack pnpm test         | exit 0；48 files、283 tests passed                                                            |
| corepack pnpm build        | exit 0                                                                                        |
| corepack pnpm test:e2e     | exit 0；6/6 passed，包括报告归档、窄屏页面、shadcn Select 键盘操作、回测日期控件、固定 Header |
| git diff --check           | exit 0                                                                                        |

## 提交与 CI

- 实现提交：[`62c63d37ed0e1cd1a683fe9ec3915ad232fd7552`](https://github.com/OYLPY/stock-monitor/commit/62c63d37ed0e1cd1a683fe9ec3915ad232fd7552)，直接推送 main。
- Quality CI：[44472642104](https://github.com/OYLPY/stock-monitor/actions/runs/44472642104) 成功，format、lint、typecheck、unit、build 和 Playwright E2E 全部通过。
- CI 对 actions/checkout@v4、actions/setup-node@v4、pnpm/action-setup@v4 提示 Node.js 20 deprecation，当前运行被强制使用 Node.js 24；不影响此次通过结果，工作流维护风险待单独更新。

## 未验证与限制

- 没有运行真实本机 Worker 或 Codex 报告生成；Playwright 只用隔离的本地 Fixture 验证浏览器流程，未调用模型。
- 没有获许可且覆盖充分的美国/日本股票 OHLCV。不会声称已实时扫描、已回测、已产生候选策略、纸面成交、余额或收益。
- BOJ/RSS 的授权状态仍由来源注册表保持 UNKNOWN；成功访问不等于取得再分发、商业使用或长期存储许可。
