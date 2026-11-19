# P11-01 Follow-up #90 验收记录

日期：2026-11-19 · [GitHub Issue #90](https://github.com/OYLPY/stock-monitor/issues/90)

## 交付物

- `pnpm dev` / `pnpm start` 通过本机启动器同时启动 Next.js 与独立 Worker；应用关闭时等待两个子进程退出。
- `/tasks` 从 SQLite 展示最近 100 条任务、状态、JST 时间、尝试次数和结果码；报告可回到归档，待处理/运行中任务可受控取消。
- Worker 状态来自 SQLite 租约。报告页任务提示链接到持久队列。
- 更新本地使用指南、调度设计、开发计划和 Issue/文档索引。

## 本地验证

| 命令                                                    | 结果                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `corepack pnpm format:check`                            | 退出码 0                                                                         |
| `corepack pnpm lint`                                    | 退出码 0                                                                         |
| `corepack pnpm typecheck`                               | 退出码 0                                                                         |
| `corepack pnpm test`                                    | 退出码 0；47 个文件、277 个测试通过                                              |
| `corepack pnpm build`                                   | 退出码 0；`/tasks` 与取消 API 构建成功                                           |
| `corepack pnpm test:e2e`                                | 退出码 0；6/6 通过，包括刷新持久化、取消、键盘、窄屏及 sticky header             |
| `git diff --check`                                      | 退出码 0                                                                         |
| 隔离副本 `corepack pnpm dev --port 3004` + `GET /tasks` | HTTP 200；服务端渲染显示 Worker 运行中；停止应用后无残留子进程且临时数据库已释放 |

E2E 使用临时 SQLite 与明确标记的 Fixture。没有请求行情/新闻服务、连接券商、执行回测或创建纸面成交。`pnpm format:check` 等仓库要求的本地检查均通过；GitHub Quality CI 和提交 SHA 待推送后补记。

## 已处理的验证阻碍

- 主工作目录的 Next 开发服务已占用 `.next` 开发锁；未停止该服务，改用不含 `.env` 的隔离副本验证 `dev`。
- 临时副本通过当前 lockfile 安装现有依赖；最初离线缓存缺少 tarball，完整原生重编译又因本机没有 Visual Studio C++ 工具链失败。最终使用已缓存依赖的 `--ignore-scripts` 链接完成隔离验证，未修改仓库依赖清单或锁文件。
