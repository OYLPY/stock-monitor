# 文档 Tag 词表

> Doc ID: DOC-0030 · 目录只在 [DOCUMENT_INDEX.md](DOCUMENT_INDEX.md) 维护；本页是 tag 词义和可用值的唯一来源。

## 规则

- tag 使用小写、英文 kebab-case 和 `namespace/value` 形式；单元格内多个 tag 以空格分隔。
- 只从下表选用；不能确定时先把词放入目录 `Keywords`，不要发明一次性 tag。
- 每文档 2–6 个 tag；至少一个 `domain/*`，其他只在确实适用时添加。
- `type`、`lifecycle`、`authority` 和 `phase` 已是独立字段，不复制成 tag。
- 新 tag 要跨文档复用且能改变检索结果；通过 Issue 同步本词表、目录和受影响条目。合并/改名时保留旧词到新词的映射说明。

## Domain

| Tag                     | 用途                                   |
| ----------------------- | -------------------------------------- |
| `domain/pmo`            | 文档管理、项目治理与检索。             |
| `domain/project`        | 产品目标、需求索引和开发路线。         |
| `domain/local-runtime`  | 本机服务、Worker、数据库和运行时边界。 |
| `domain/workflow`       | 研究流程、Codex 调用和任务编排。       |
| `domain/market-data`    | 行情、新闻、公司行动、日历和来源。     |
| `domain/quant-research` | 指标、策略假设、回测和验证。           |
| `domain/trading-risk`   | 纸面计划、风险和账本规则。             |
| `domain/security`       | 威胁、信任边界、隐私和秘密。           |
| `domain/ui`             | 页面、交互、设计系统和可访问性。       |

## Phase

适用开发阶段使用 `phase/p00` 至 `phase/p13`；跨阶段治理使用 `phase/cross-cutting`。Phase tag 表示责任/关联阶段，不表示文档权威等级或完成状态。

## Market

| Tag             | 用途                             |
| --------------- | -------------------------------- |
| `market/us`     | 仅涉及美国目标市场。             |
| `market/jp`     | 仅涉及日本目标市场。             |
| `market/shared` | 跨市场规则、共同数据或比较分析。 |

## Concern

| Tag                           | 用途                                    |
| ----------------------------- | --------------------------------------- |
| `concern/accessibility`       | 键盘、焦点、语义和辅助技术可用性。      |
| `concern/agent-runtime`       | Codex 任务执行、提示版本和步骤记录。    |
| `concern/api`                 | 请求/响应、状态码和 API 边界。          |
| `concern/architecture`        | 系统边界、模块职责和运行拓扑。          |
| `concern/backtest`            | 历史模拟、样本外验证和指标。            |
| `concern/context`             | 上下文压缩、检索和可恢复交接。          |
| `concern/dependencies`        | 外部包、许可和第三方组件。              |
| `concern/document-lifecycle`  | 文档 ID、命名、替代和归档。             |
| `concern/notifications`       | 异常事件选择、去重和通知。              |
| `concern/paper-trading`       | 本地计划和纸面模拟。                    |
| `concern/provenance`          | 来源、时间、版本和证据链。              |
| `concern/provider-evaluation` | 供应商覆盖、许可、费用和延迟。          |
| `concern/recovery`            | 重启、崩溃、备份和恢复。                |
| `concern/reliability`         | 超时、错误、可用性与容量。              |
| `concern/retrieval`           | 文档目录、关键词、tag 与 RAG metadata。 |
| `concern/risk-limits`         | 单笔风险、回撤和禁止边界。              |
| `concern/scheduling`          | 日历、时间窗口、幂等、重试和调度。      |
| `concern/security`            | 授权、loopback、输入信任和秘密。        |
| `concern/storage`             | SQLite、schema、事务和账本存储。        |
| `concern/traceability`        | 需求—设计—测试和来源关系。              |

## 目录校验

目录每个 tag 必须精确匹配此词表；phase 值限定于 `p00`–`p13` 或 `cross-cutting`，不另造大小写或同义词。按 tag 筛选时，仍需检查目录条目的 lifecycle 和 authority。
