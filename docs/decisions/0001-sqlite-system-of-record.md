# ADR-0001：以 SQLite 作为本地系统记录库

- 状态：Accepted
- 日期：2026-11-15
- 范围：V1 本地 Web、独立 Worker、研究记录和纸面账本

## 背景

V1 由本机 Next.js 服务和独立 Node Worker 组成。任务、研究结果、来源记录和不可变纸面账本必须在浏览器关闭后仍可访问，并由 Web 与 Worker 共享。产品无需登录或用户管理，不依赖云数据库。

IndexedDB 能为网页提供离线持久化，浏览器 Web Worker 也能访问它；但项目最低 Node 版本 22.14 的内置全局 API 不包含 `indexedDB`，Node Worker 也不是持有浏览器 origin 存储的 Web Worker。若把 IndexedDB 定为权威存储，后台任务就会依赖浏览器进程、额外存储适配器或另一套数据同步与冲突处理。

## 决策

以本机应用数据目录中的 SQLite 文件作为唯一权威存储。Next.js 和 Worker 只能通过各自服务端的 Infrastructure 适配器读写；浏览器只访问本机同源 API，不直接访问数据库文件。账本事件仍只能由确定性纸面交易用例追加。

SQLite 与数据库文件必须位于本机文件系统，不放在网络共享目录。所有写操作使用短事务，不在外部网络或模型调用期间持有事务。可并发读取不能解释为多写者无冲突；P03/P04/P05 需明确认领事务、忙锁时限、迁移与并发恢复。若采用 WAL，须同时处理 WAL/SHM 文件、checkpoint 和一致性备份；禁止把运行中的主数据库文件单独复制为备份。

IndexedDB 不作为权威存储，也不为当前 V1 增加浏览器缓存或离线写队列。若未来只缓存可重建的展示数据，必须明确其非权威性，且不得缓存账本凭据或以浏览器副本回写服务端。

## 替代方案

| 方案                   | 取舍                                                                                            | 结论    |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| IndexedDB 为系统记录库 | 可从页面离线读写，但后台 Node Worker 不能直接共享；需增加浏览器服务进程依赖或同步/冲突机制。    | 拒绝    |
| SQLite 为系统记录库    | 一份本机事务数据库可由 Next.js 与独立 Worker 使用；需处理单写者竞争、文件权限、锁、恢复和备份。 | 采用    |
| 远端数据库             | 需要网络服务和远端数据管理，超出本地工具边界。                                                  | V1 排除 |

## 后果与失败处理

- SQLite 不可读、损坏、空间不足、权限不足或迁移不兼容时，禁止相关写入，不推导余额、持仓、收益或任务成功；保留原文件并明确显示 `UNAVAILABLE` 或具体失败状态。
- Worker 与 Web 发生忙锁时只按有限时限重试；超限后记录失败，不能无限阻塞 UI 或后台队列。
- 备份使用 SQLite 一致性快照能力（Online Backup API 或适用的 `VACUUM INTO`），恢复前先校验临时副本；不得直接用未验证副本覆盖现有库。
- 物理磁盘损坏、操作系统/账户被攻破和用户主动删除数据不属于 SQLite 事务保证范围；备份策略由 P05/P13 设计并验收。

## 后续验证

P04-02 验证当前 Node/SQLite 驱动、Drizzle、精度、迁移、事务和进程竞争；P03-01 细化 Schema 与不变量；P03-05 定义持久队列认领与幂等；P05 实现连接、迁移和备份恢复。此 ADR 是存储选择，不表示数据库已接入或并发/恢复门槛已通过。

## 依据

- [SQLite Write-Ahead Logging](https://www.sqlite.org/wal.html)：同主机 WAL 的并发读取/写入特性、网络文件系统限制和 checkpoint。
- [SQLite Online Backup API](https://sqlite.org/backup.html)：活动数据库的一致性快照和文件直接复制的限制。
- [MDN：WorkerGlobalScope.indexedDB](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/indexedDB)：IndexedDB 由浏览器 Web Worker 提供，而非 Node Worker。
- [MDN：IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)：浏览器数据库的交易、版本迁移及存储配额语义。
- [Node.js v22.14 Global Objects](https://nodejs.org/download/release/v22.14.0/docs/api/globals.html)：项目最低 Node 版本的内置 globals 清单中没有 `indexedDB`。若未来最低运行时变化，重新核验此取舍。
