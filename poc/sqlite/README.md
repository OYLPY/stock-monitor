# SQLite / Drizzle 精度与迁移 PoC

本 PoC 记录 P04-02 的本地技术可行性验证。它只使用合成数值 fixture，在系统临时目录创建并删除 SQLite 文件，不访问行情或外部服务。

## 运行

```powershell
node --experimental-strip-types poc/sqlite/smoke.ts
pnpm exec drizzle-kit generate --config=poc/sqlite/drizzle.config.ts --name=verify
```

第一条命令执行 BigInt 精度、溢出、`RETURNING`、迁移幂等/校验和/回滚、`user_version`、文件重开和跨进程写锁断言。第二条命令检查 Drizzle Kit schema snapshot 没有未生成的 schema 变化。

实际输出和质量命令退出码记录在 [actual-run-2026-11-16.jsonl](actual-run-2026-11-16.jsonl)；结论和边界见 [P04-02 调研记录](../../docs/research/p04-02-sqlite-drizzle-findings.md)。

## 设计观察

- POC 使用 `better-sqlite3`、Drizzle ORM 和 Drizzle Kit 的固定版本，SQLite 运行时版本由驱动内实际连接查询。
- `better-sqlite3` 连接开启 `defaultSafeIntegers(true)`。Drizzle `INTEGER` 列用内部 `customType` 映射 TypeScript `bigint`，scale 列只转换为安全整数 `number`；金额、价格、汇率尾数和股数保持 SQLite 有符号 64 位整数。
- Drizzle Kit 生成的 `0000_initial.sql` 不含 `STRICT`。PoC 在生成 SQL 中显式加入 `STRICT`，并从 `sqlite_master` 核实最终表定义。该约束不会由 schema snapshot 自动维护，未来修改表后必须重新核验生成 SQL。
- PoC 使用最小迁移 runner，按 `BEGIN IMMEDIATE` 事务逐条应用并写入 `schema_migrations`、SHA-256 和 `PRAGMA user_version`。它是对既有迁移契约的可行性验证，不是已接入产品的迁移实现。

## 边界

这不是 P05 产品数据库实现；尚未验证完整产品 schema、外键关系集、备份/恢复、崩溃电源故障、100k 数据性能和真实市场数据。P05 需将 driver 与迁移策略接入应用边界，并由 P12 做集成和恢复验收。
