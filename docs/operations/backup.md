# 本地 SQLite 备份与恢复

> Doc ID: DOC-0039 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 适用范围

本手册说明如何使用本机 CLI 备份、预检和恢复 SQLite 数据库。命令需要 Node.js 与项目依赖，不访问网络、行情服务或 Codex 服务，也不需要任何服务凭据。

备份是 SQLite Online Backup API 生成的一致性快照，会包含数据库中的全部业务数据和现有来源/Fixture 标记。它不包含数据库以外的配置、日志或环境变量。系统设计要求服务凭据保存在 OS 本机安全配置中，不写入 SQLite；不要把凭据手工放入数据库。

## 备份

备份源路径和输出目录都必须是绝对路径。输出目录必须不存在；命令不会替换既有备份。

```powershell
pnpm backup -- "D:\data\stock-monitor.sqlite" "D:\backups\stock-monitor-2026-11-16"
```

产物目录包含：

- `database.sqlite`：在线一致性快照，不是对活动 WAL 数据库主文件的裸复制。
- `manifest.json`：备份格式版本、应用版本、Schema 版本、创建时刻、文件长度、SHA-256 和已应用迁移及校验和。

数据库快照与 manifest 在临时目录生成，完成完整性/外键检查后发布。manifest 最后写入；如果进程中断且 manifest 缺失，预检会拒绝该不完整备份。备份失败时保留原数据库和已有输出目录。

### 设置页备份

应用的“设置”页可创建同样的 SQLite 一致性快照。它通过受本机来源检查保护的 POST 请求运行，默认保存到应用数据目录的 `backups` 子目录；每次使用唯一目录，不覆盖当前数据库或既有备份。成功消息显示完整本机目录，失败时显示统一错误提示。备份接口不会返回环境变量或服务凭据。

## 预检

预检验证 manifest 格式、文件长度和 SHA-256、SQLite `integrity_check`、外键、`user_version` 与迁移记录。它会把数据库复制到系统临时目录，在临时副本上执行兼容的向前迁移，再验证迁移后的数据库；不会修改备份或已有数据库。

```powershell
pnpm restore -- --check "D:\backups\stock-monitor-2026-11-16"
```

成功输出 JSON `status: valid`，包含源与恢复后的 Schema 版本。失败输出 JSON `status: rejected`、稳定错误码和诊断信息，并以非零退出码结束。

## 恢复到新数据库

恢复只接受一个从未使用过的新绝对文件路径。目标数据库以及同名 `-wal` / `-shm` sidecar 任一已存在时，命令拒绝操作。恢复不会覆盖或删除原数据库或备份。

```powershell
pnpm restore -- "D:\backups\stock-monitor-2026-11-16" "D:\data\stock-monitor-restored.sqlite"
```

命令先将快照复制到目标目录下的临时位置，校验哈希、完整性、外键、迁移记录和应用版本兼容性，并在临时副本执行必要的向前迁移。所有检查通过并关闭数据库后，使用同一文件系统的原子硬链接将完整文件发布到新路径；目标路径被并发创建时操作失败，不会替换该文件。当前文件系统若不支持硬链接，命令会失败并保留备份和现有数据库。

恢复成功输出 JSON `status: restored` 和目标路径。恢复源版本较旧时，输出同时给出 `sourceSchemaVersion` 与 `restoredSchemaVersion`。预检或恢复不连接外部行情，也不把本地测试 Fixture 转换成真实行情。

## 常见拒绝报告

| 错误码                                              | 含义                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| `MANIFEST_UNREADABLE` / `MANIFEST_INVALID`          | manifest 缺失、不可读或字段不符合备份格式。                      |
| `DATABASE_UNREADABLE`                               | 备份缺少数据库文件或 SQLite 无法打开文件。                       |
| `DATABASE_SIZE_MISMATCH` / `DATABASE_HASH_MISMATCH` | 数据库文件与 manifest 中记录的长度或 SHA-256 不一致。            |
| `DATABASE_INTEGRITY_FAILED`                         | SQLite 完整性检查发现损坏。                                      |
| `DATABASE_FOREIGN_KEY_CHECK_FAILED`                 | 数据库存在外键孤儿记录。                                         |
| `DATABASE_SCHEMA_VERSION_MISMATCH`                  | manifest、`user_version` 和迁移记录不一致。                      |
| `SCHEMA_INCOMPATIBLE`                               | 当前程序无法验证/前向迁移备份中的 Schema 或 migration checksum。 |
| `RESTORE_TARGET_EXISTS`                             | 新目标文件或 SQLite sidecar 已存在；原数据保持不变。             |
| `RESTORE_CHECKPOINT_FAILED`                         | 临时恢复库不能完成 WAL checkpoint，未发布目标文件。              |

拒绝后保留原始备份，按 JSON 报告中的错误码定位问题。不得通过删改现有数据库、移除迁移校验或手工改写 manifest 绕过检查。

## 当前实现边界

- CLI 显式接收数据库路径；它不猜测或修改应用运行时的数据路径。
- 设置页备份使用 `getLocalDatabasePath()` 的应用路径，并将快照放入其旁边的 `backups` 子目录；命令行仍可为独立环境显式指定路径。
- 恢复目标必须是新文件，不提供覆盖恢复或自动切换当前应用数据库的开关。
- 备份会保存 SQLite 内现有数据和来源标记；数据是否为 REAL、DELAYED、HISTORICAL 或 DEMO_ONLY 由其原有记录决定。
- P10-05 的恢复验证会在子进程留下未提交 WAL 写入后重新打开数据库，并确认账本审计与已提交状态一致；该测试验证 SQLite 的进程中断恢复，不模拟设备断电或硬件故障。
- 100,000 条账本记录在 60 秒内完成备份校验和恢复的基准由 P12 性能验收负责；本任务的文件型测试不代表该基准已通过。

## 需求与实现追踪

- 需求：[NFR-007](../requirements/NFR.md)、[RQ-026 / AC-NFR-011](../requirements/TRACEABILITY.md)
- 设计：[SQLite Schema 与恢复规则](../design/DB_SCHEMA.md)
- 实现：`src/db/backup.ts`、`src/app/api/v1/backup/route.ts`、`scripts/backup.ts`、`scripts/restore.ts`
- 验证：`src/db/backup.test.ts`（真实临时 SQLite 文件、WAL 快照、已知纸面账本、进程中断恢复、审计摘要一致、损坏与路径保护）、`src/app/api/v1/backup/route.test.ts` 与 P06-06 Playwright 冒烟
- Issue：[P05-05 / #41](https://github.com/OYLPY/stock-monitor/issues/41)、[P06-06 / #47](https://github.com/OYLPY/stock-monitor/issues/47)、[P10-05 / #68](https://github.com/OYLPY/stock-monitor/issues/68)
