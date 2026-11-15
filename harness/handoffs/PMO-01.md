# PMO-01 交接

## Objective

- Issue：[#88 — 建立设计文档编号、索引与标签治理工作流](https://github.com/OYLPY/stock-monitor/issues/88)。按用户授权直接在 `main` 完成 PMO 文档规则，不创建 PR。

## Established facts

- 仓库目前以 `docs/ISSUE_INDEX.md` 管理任务，以 `docs/requirements/REQUIREMENTS_INDEX.md`/`TRACEABILITY.md` 映射需求；尚无统一文档 ID、总目录或 tag 词表。
- 现有长期文档分布在 `docs/requirements/`、`docs/design/`、`docs/decisions/`、`docs/research/`、`docs/testing/` 和根级文件；现有路径和 ADR/RQ/FR/AC/Pxx ID 不应批量重命名或重编。
- P03-05 / #32 已开始，`docs/design/SCHEDULER.md` 为未提交草稿；本 Issue 暂停该设计提交，PMO 完成后恢复 #32。

## Applied changes

- `docs/pmo/DOCUMENT_GOVERNANCE.md` 定义执行约束与产品内容的双重权威层级、受控文档类型/authority、全局稳定 Doc ID、命名、生命周期和 Issue 驱动变更工作流。
- `docs/pmo/DOCUMENT_INDEX.md` 为现有 31 份 `docs/` 长期 Markdown 登记唯一 Doc ID、类型、lifecycle、authority、tags、关键词、旧编号、关联 Doc ID 和路径；原文件名与 RQ/FR/AC/ADR/Pxx 编号保留。
- `docs/pmo/TAG_TAXONOMY.md` 建立 domain/phase/market/concern 受控词表；`docs/templates/DOCUMENT_TEMPLATES.md` 覆盖 PMO、产品/需求、用例、架构/领域设计、ADR、契约、研究、运维/恢复、验收证据和 Issue handoff。
- `docs/INDEX.md` 提供文档快速入口和检索/RAG metadata 说明；`AGENTS.md` 增加短指针；`docs/ISSUE_INDEX.md` 将 PMO-01 独立列为跨阶段工作项。

## Verification

- 自定义 PowerShell 自检通过：31 个 Doc ID 唯一；类型、authority、tags 均在受控集合中；tag 数量、目录文件覆盖、主路径、Related Doc IDs 和本地 Markdown 链接均有效。
- `pnpm format:check`：exit 0；`pnpm lint`：exit 0；`pnpm typecheck`：exit 0；`pnpm test`：exit 0（3 files / 19 tests）；`pnpm build`：exit 0。
- `pnpm exec prettier --check`（新增 PMO/模板/索引与 handoff）：exit 0；`git diff --cached --check`：exit 0。
- 远端 Quality CI 尚待提交推送后确认；文档变更无独立 integration 命令。

## Dead ends

- 不引入向量数据库；先以单一 Markdown 目录、受控 tag 和全文搜索满足当前规模，并保留后续 RAG 所需 metadata。
- 不把 Issue 索引、需求追踪表和文档目录合并：三者分别管理任务、需求关系和文档元数据。

## Remaining plan

1. 定向检查本次新增文档格式，stage PMO 相关文件并运行 `git diff --cached --check`；确认未包含 P03-05 草稿。
2. 提交/push main，确认 Quality CI；补齐交接和索引完成状态，再次 push 并确认 Quality CI。
3. 更新并关闭 Issue #88，然后恢复 P03-05 / #32。
