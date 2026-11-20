# P06-FU-01 市场监测与研究报告 UI/UX 验收

日期：2026-11-20

Issue：[P06 follow-up #93](https://github.com/OYLPY/stock-monitor/issues/93)

## 结果

- `/markets` 使用 shadcn 美股/日股 Tabs。市场选择统一控制对应数据源、图表、CSV 导入和行情明细；无数据时显示单一空态。没有密钥时不显示失效的获取表单；来源限制、整批历史明细和导入表单按需展开。CSV 和一年期 EODHD 数据不作为策略验证或回测依据。
- `/reports` 首屏展示报告结论、验证状态与风控结果；完整审计信息按需展开。报告历史和持久任务队列使用独立页签；队列表保留状态、提交时间、结果、取消及全部任务入口。
- 报告推论只有在其 `evidenceIds` 与已存事件证据编号相交时才显示关联事件，并明确提示关联不代表因果。状态码和结果码在可见 UI 中使用简体中文。
- 未修改 `src/components/ui/*` 或 shadcn 生成组件源码；未添加自定义组件 CSS。未接入真实行情、未声称实时扫描或模拟成交。

## 验证记录

- `corepack pnpm format:check` — exit 0。
- `corepack pnpm typecheck` — exit 0。
- `corepack pnpm test` — exit 0，56 files / 321 tests。
- `corepack pnpm build` — exit 0，Next.js 16.4.6 production build 成功。
- `corepack pnpm exec eslint src scripts tests` — exit 0。
- `corepack pnpm exec playwright test --reporter=dot` — exit 0，10 tests passed。隔离临时数据库中验证市场键盘切换、CSV disclosure、窄屏无横向溢出；报告筛选、队列刷新持久化、tab 切换、报告证据和审计详情。
- 隔离数据目录的 Chromium 手动截图：桌面 1365px、窄屏 320px 的 `/markets` 与 `/reports`；页面空态和信息层级已目视复核。截图保存在当前机器临时目录，不作为行情事实。
- 提交 [`c61593c0de4e91771aa9cdafd5af9d694fe5dc70`](https://github.com/OYLPY/stock-monitor/commit/c61593c0de4e91771aa9cdafd5af9d694fe5dc70) 已推送 `main`；匹配 [Quality CI 44751449777](https://github.com/OYLPY/stock-monitor/actions/runs/44751449777) 全部成功，包含 frozen install、format、全仓 lint、typecheck、unit、build 和 Playwright E2E。
- `corepack pnpm lint` — exit 1：ESLint 将工作区未跟踪的 `.next-p11-05/` 构建产物纳入扫描，报告生成 JavaScript 的 lint 错误；未修改或暂存此目录。完整源码、脚本和测试目录的 lint 通过；干净检出中的全仓 lint 已由 Quality CI 44751449777 验证通过。

## 限制与剩余事项

- 本机没有 EODHD API Key；没有发起真实供应商请求。美股行情仍不可用，#49 保持 open / `BLOCKED_EXTERNAL`；#50 日股行情仍被免费历史跨度和许可约束阻断。
- 截图验收前一次误启动了非隔离 Worker，导致本机报告任务 `e6e5afad-bfef-43f1-9c76-dade95d4a756` 留有已过期运行租约。服务已停止；没有手工修改数据库。该情况和恢复方式记录在 `harness/state/current.md` 与 P07-02 交接中。
- #93 的实现、push、匹配 Quality CI 和 Issue 关闭均已完成；本次仅补齐文档索引中的最终验收状态。
