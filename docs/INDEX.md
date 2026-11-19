# 文档入口

本页是文档检索入口；完整 metadata 只维护在 [文档目录](pmo/DOCUMENT_INDEX.md)。

产品本地运行说明见 [README](../README.md)，仓库协作和安全约束见 [AGENTS.md](../AGENTS.md)。

## 按目的查找

- 新建、修改、替代文档或判断规范优先级：读 [PMO 文档治理](pmo/DOCUMENT_GOVERNANCE.md)。
- 按 Doc ID、类型、状态、authority、tag、关键词或历史编号定位：查 [文档目录](pmo/DOCUMENT_INDEX.md) 和 [tag 词表](pmo/TAG_TAXONOMY.md)。
- 复制文档结构：用 [文档模板](templates/DOCUMENT_TEMPLATES.md)。
- 查 GitHub Issue、阶段与任务依赖：用 [Issue 索引](ISSUE_INDEX.md)；它只管理工作项。
- 查 RQ/FR/AC 的需求关系：用 [需求索引](requirements/REQUIREMENTS_INDEX.md) 与 [追踪矩阵](requirements/TRACEABILITY.md)；它们不替代文档目录。
- 首次使用、理解各页面步骤、状态标签、研究限制与常见问题：读[使用指南](USER_GUIDE.md)。
- 查阶段目标与依赖路线：用 [开发计划](DEVELOPMENT_PLAN.md)。
- 查 UI token、shadcn 组件和可访问性约定：用 [UI 设计规范](design/UI_DESIGN.md)。
- 查市场日历、交易时段和调度通知契约：读 [调度与事件通知契约](design/SCHEDULER.md)。
- 查本地 SQLite 快照、预检与安全恢复步骤：用 [备份与恢复手册](operations/backup.md)。

## 检索顺序

1. 先在目录中按 Doc ID、旧编号、type、tag 或关键词定位，并确认 lifecycle 与 authority。
2. 有多个结果时优先读当前有效且 authority 更高的文档；跟随 `Related Doc IDs` 链到对应需求/ADR/契约。
3. 再用全文搜索定位细节，例如 `rg -n 'walk-forward|退市' docs -g '*.md'`。
4. 发生冲突时按 PMO 治理文档中的权威层级处理，并在对应 Issue 里更新来源文档和追踪关系。

常用检索示例：

- 按主题 tag 或关键词从目录筛选：`rg -n 'concern/storage|SQLite' docs/pmo/DOCUMENT_INDEX.md`。
- 按历史任务编号找对应文档：`rg -n 'P04-02|#34' docs/pmo/DOCUMENT_INDEX.md`。
- 按正文概念查找并保留文件/行号：`rg -n 'foreign key|外键' docs -g '*.md'`。

> 本目录面向人和未来检索器；当前使用 Markdown、受控 tags 和全文搜索，不要求本地向量数据库。
