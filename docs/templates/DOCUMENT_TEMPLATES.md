# 文档模板

> Doc ID: DOC-0031 · 新建时先在 [文档目录](../pmo/DOCUMENT_INDEX.md) 分配 Doc ID 和 metadata，再复制适用模板。

## 共用首部

新文档首部保持短小，metadata 的完整唯一记录在 `docs/pmo/DOCUMENT_INDEX.md`：

```markdown
# <清楚描述主题的标题>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)
```

不要在正文重复维护 tags、lifecycle 或 authority。原有 ADR、RQ/FR/AC/Issue 编号放入 `Aliases / refs` 或关联章节。

## PMO / 标准

```markdown
# <标准名称>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 目的与边界

## 适用规则

## 工作流

## 例外与冲突处理

## 可核验完成标准

## 相关文档与来源
```

定义跨项目/多文档重复执行的规则；将内容范围清晰的专业细节链接到所属文档。

## 产品范围 / PRD

```markdown
# <产品或能力名称>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 问题、目标和成功标准

## 目标用户与使用环境

## 产品范围与非目标

## 主要工作流

## 产品边界、风险和假设

## 交付阶段与验收门槛

## 关联需求与决策
```

## 功能 / 非功能需求

```markdown
# <功能/非功能需求主题>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 背景与目标

## 用户/触发/输入/输出

## 必须行为

## 失败与降级

## Given / When / Then 验收

## 来源、依赖与范围外事项
```

既有 RQ/FR/NFR/AC 编号不能复用；需求应能追溯到用例、设计和测试责任。每条要求使用唯一 ID，并把可观察的成功和失败行为写入验收条件。

## 用户用例

```markdown
# <用例集合>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 参与者与前置条件

## 主成功场景

## 替代与失败路径

## 输入、输出与状态变化

## Given / When / Then 验收

## 关联需求与设计
```

## 架构 / 领域设计

```markdown
# <组件或领域> 设计

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 状态与依据

## 目标 / 非目标

## 边界与术语

## 决策与备选方案

## 数据、时序或状态模型

## 接口与错误/缺失行为

## 安全、权限和持久化

## 示例与可手算验收

## 需求追踪、依赖与未决问题
```

标出设计基线与未实现边界；流程复杂时使用 Mermaid；只记录对当前需求必要的选择。

## ADR / 决策

```markdown
# ADR-____: <决策标题>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

- 状态：Proposed / Accepted / Superseded
- 日期：YYYY-MM-DD
- 相关 Issue / Doc ID：

## 背景与约束

## 决策

## 考虑过的选项

## 后果、风险和回退条件

## 替代/关联决策
```

已作出的决策追加新 ADR，不静默改写历史理由。ADR 状态与目录 lifecycle 分开。

## API / 数据契约

```markdown
# <接口或数据契约>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 边界与版本

## Schema / 字段 / 精度

## 调用与状态迁移

## 幂等、超时与错误语义

## 权限、来源与保密

## 示例与边界验收

## 调用方、消费者与需求追踪
```

## 研究 / 外部数据调查

```markdown
# <调查问题>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 问题与 as-of 日期

## 方法与筛选标准

## 来源（直接链接、访问日期、许可/限制）

## 发现与相反证据

## 结论、置信边界与待验证项

## 决策影响与下一步
```

将观察、推断和未核实事实分开；外部条款/价格/能力变化时重新核验。

## 运维 / 恢复手册

```markdown
# <操作场景>

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 适用版本与触发条件

## 观察症状与诊断步骤

## 安全恢复步骤

## 成功判据与失败回退

## 数据影响与不可逆操作

## 证据与关联 Issue
```

## 测试 / 验收证据

```markdown
# <任务或能力> 验收记录

> Doc ID: DOC-____ · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 目标、范围与基线提交

## 环境与数据/Fixture 状态

## 执行命令与退出码

## 结果、数量与失败位置

## 未执行项目与限制

## 关联 Issue、需求和设计
```

只记录实际执行的命令和观察到的结果；离线 Fixture、外部服务阻断与未验证行为必须明确区分。

## Issue handoff

任务 handoff 继续使用 [AGENTS.md](../../AGENTS.md) 规定的六节，不复制另一份模板规则：Objective / Established facts / Applied changes / Verification / Dead ends / Remaining plan。
