# P07-02 美股历史行情适配器与市场页验收

日期：2026-11-20

Issue：[P07-02 / #49](https://github.com/OYLPY/stock-monitor/issues/49)

## 实现状态

- 增加 EODHD Free 美股 EOD 日线 Provider、loopback API 路由、本机缓存/审计、每日请求限额、来源快照与本机存储；API Key 仅由服务环境变量读取。
- 行情请求范围最多一年、单次一个证券、每日最多 20 次。供应商原始 OHLC、拆股调整成交量及缺少公司行动的限制已记录在 `docs/research/data-sources.md` 和产品指南。
- 市场页按美股/日股切换显示；来源限制、CSV 表单、行情明细按需展开。CSV 与短期 EOD 数据只用于查看，不进入策略验证、回测或纸面账本。

## 验证记录

- `corepack pnpm format:check` — exit 0。
- `corepack pnpm typecheck` — exit 0。
- `corepack pnpm test` — exit 0，56 files / 321 tests；包含 Provider、API 路由、限流/缓存和行情解析单测。
- `corepack pnpm build` — exit 0。
- `corepack pnpm exec eslint src scripts tests` — exit 0。
- `corepack pnpm exec playwright test --reporter=dot` — exit 0，10 tests passed；隔离数据库下检查市场 tab 键盘操作、CSV disclosure、320px 窄屏、报告队列持久化和报告摘要/审计页面。
- `corepack pnpm lint` — exit 1：全仓扫描误纳入未跟踪 `.next-p11-05/` 生成文件；该目录未修改或暂存。完整源码、脚本和测试目录的 lint 通过；干净检出中的全仓 lint 已由 Quality CI 44751449777 验证通过。
- 提交 [`c61593c0de4e91771aa9cdafd5af9d694fe5dc70`](https://github.com/OYLPY/stock-monitor/commit/c61593c0de4e91771aa9cdafd5af9d694fe5dc70) 已推送 `main`；匹配 [Quality CI 44751449777](https://github.com/OYLPY/stock-monitor/actions/runs/44751449777) 的全仓 lint 与其它检查全部成功。

## 数据授权与阻断

- 用户允许接入免费 EODHD Free API；没有本机 API Key，因此未发送任何真实行情请求，也没有报告线上 Provider 可用。
- 没有 EODHD 免费层的多年历史、实时数据或公司行动数据，无法满足数十年策略验证。#49 保持 open / `BLOCKED_EXTERNAL`，不关闭；需要密钥并完成真实来源验收后再继续。
- UI 信息架构与视觉验收的补充记录见 [P06-FU-01 UI/UX 验收](P06-FU-01-ui-ux.md)。
