# P04-02：SQLite / Drizzle 精度与迁移核验

> Doc ID: DOC-0035 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

**核验日期：2026-11-16**

## 问题与范围

核验 SQLite/Drizzle 能否在不经过 JavaScript 浮点数的情况下精确保存 JPY、定点 USD、价格、FX 汇率和股数，并实际执行 `STRICT` schema、幂等迁移、失败回滚、`RETURNING`、关闭重开和跨进程写锁检查。

这是 P04 可行性 PoC，不把本地脚本结果等同于 P05 产品运行时验收。

## 方法与环境

- 使用本仓库锁定的 `better-sqlite3` 13.2.0、Drizzle ORM 0.45.4 和 Drizzle Kit 0.31.11；Node.js 为 22.14.0，实际 SQLite 版本从已打开的驱动连接读取。
- 本地 npm package metadata 标注 `better-sqlite3` 和 `drizzle-kit` 为 MIT、`drizzle-orm` 为 Apache-2.0；这是直接依赖的 license 字段核对，不代替全量依赖或发行合规审查。
- 依据 P03-01 的 SQLite INTEGER、`STRICT`、`schema_migrations`、SHA-256、`PRAGMA user_version`、`BEGIN IMMEDIATE` 契约，生成初始 DDL 并运行断言式 smoke 脚本。
- 所有金额和价格样本均为手工指定的合成边界值；数据库放在操作系统临时目录，测试完成后删除。未调用网络、市场数据、凭据或外部服务。

## 发现与实际证据

### 精确整数映射

Drizzle SQLite 的常规 `integer()` 映射为 JavaScript `number`；其内建 BigInt 模式采用 BLOB 表示，不满足本项目以 SQLite `INTEGER` 存储 int64 的设计。PoC 使用 `better-sqlite3` 的 `defaultSafeIntegers(true)`，并通过 Drizzle `customType` 将整数字段作为 TypeScript `bigint` 读写。小范围 scale 字段在驱动边界检查 `Number.isSafeInteger` 后才转换为 `number`。

实际 fixture 包含 JPY `9007199254740993`、USD `90071992547409.93`（最小单位 `9007199254740993`）、USD/JPY `149.123456`（尾数 `149123456`、scale 6），以及价格 `9876543.2100` 与 1,000,000,000 股。金额跨过 JavaScript `Number.MAX_SAFE_INTEGER`，但低于 SQLite signed int64 上限；Drizzle insert、`INSERT … RETURNING`、关闭并重开数据库后的查询均与原始 BigInt 对象完全相等。超出 SQLite int64 的写入被明确拒绝，过多小数位和 `CHECK` scale 越界也被拒绝。

### Schema 与迁移

驱动连接报告 SQLite 3.54.1，满足 SQLite 3.37 起可用的 `STRICT` 表要求。Drizzle Kit 生成的初始 SQL 本身没有 `STRICT`；PoC 为迁移 SQL 显式添加 `STRICT`，并查询 `sqlite_master` 断言实际建表定义。再次执行 `drizzle-kit generate` 后输出 `No schema changes`。

Drizzle Kit 0.31.11 为首个迁移生成 `0000_initial.sql`（journal `idx` 为 0）；PoC 和 DB_SCHEMA 使用逻辑版本 1，并在 `schema_migrations` 与 `PRAGMA user_version` 中保存 1。设计文档已对齐为将生成文件序号与数据库逻辑版本分开。

最小 runner 以 `BEGIN IMMEDIATE` 逐条应用迁移，并在同一事务中写入版本、迁移名、SHA-256、应用版本、应用时间和 `PRAGMA user_version`。重复应用不会重复写入；已应用 SQL 的哈希改变时拒绝启动。迁移故障注入先创建临时表，再尝试将 `1.5` 写入 STRICT INTEGER；实际错误为 `SQLITE_MISMATCH`，事务回滚后临时表不存在，迁移历史与 `user_version` 保持原值。另一个业务事务中，第二笔 CHECK 失败时第一笔写入也被回滚。

### 并发与恢复观察

数据库以 WAL 打开，连接启用外键、有限 200 ms busy timeout 和 `synchronous=FULL`。父进程持有 `BEGIN IMMEDIATE` 时，子进程尝试写入收到 `SQLITE_BUSY`（退出码 2）；父进程释放事务后，同一子进程探针写入成功。文件关闭重开后，整数值、Schema、迁移记录和外键开关可读，`PRAGMA integrity_check` 返回 `ok`。

完整脱敏输出见 [实际运行 JSONL](../../poc/sqlite/actual-run-2026-11-16.jsonl)，断言脚本见 [PoC README](../../poc/sqlite/README.md)。

## 结论、置信边界与后续

**已核实：**当前锁定版本可将 SQLite signed int64 以 BigInt 精确映射；`INSERT … RETURNING` 保留 BigInt；PoC 的 STRICT 表、迁移幂等/校验和/回滚、`user_version` 原子更新、文件重开和跨进程单写锁边界均通过实际运行。

**实现建议：**P05 可继续评估 `better-sqlite3` 与 Drizzle，但金融整数必须使用 BigInt + SQLite INTEGER 的自定义映射；不要把 Drizzle 的普通 `number` integer 或 BLOB BigInt 模式当作本设计的直接实现。Drizzle Kit 生成的每个 SQLite migration 都需核对并验证 `STRICT`，因为本 PoC 的生成文件和 snapshot 没有自动表达此约束。P05 应决定把该校验纳入迁移生成/审查流程。

**尚未证明：**完整业务 Schema 的外键约束集合、崩溃/断电一致性、备份与恢复、100k 事件恢复时限、产品数据目录权限、实际应用启停和跨进程长时间负载仍由 P05/P12 验收。该 PoC 不代表这些 NFR 已实现。

## 来源（直接链接、访问日期与边界）

| 来源                                                                                                      | 用途                                       | 边界                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| [Drizzle SQLite column types](https://orm.drizzle.team/docs/sqlite/column-types)                          | integer、BigInt 与 SQLite 存储模式         | 文档持续更新；版本特定行为以本地锁定版本与 PoC 为准   |
| [Drizzle SQLite drivers](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)                         | better-sqlite3 驱动接入方式                | 只用于 API 参考，不替代本机运行证据                   |
| [better-sqlite3 integer handling](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/integer.md) | JavaScript BigInt 与 SQLite int64 安全范围 | master 页面可能随项目变更；实际行为以 13.2.0 PoC 为准 |
| [SQLite STRICT tables](https://www.sqlite.org/stricttables.html)                                          | STRICT 类型约束及最低版本                  | 本机实际 runtime 版本另由 PoC 查询                    |
| [Drizzle migrations](https://orm.drizzle.team/docs/migrations)                                            | 迁移生成与执行概念                         | 官方指南未定义本项目恢复/审计契约                     |
| [P03-01 SQLite Schema](../design/DB_SCHEMA.md)                                                            | 本项目数据与迁移设计基线                   | 当前是设计，不表示产品运行时已实现                    |
