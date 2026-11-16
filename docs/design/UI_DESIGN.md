# UI 设计与现代 Web 实施约定

> Doc ID: DOC-0017 · metadata 以[文档目录](../pmo/DOCUMENT_INDEX.md)为准。

参考：[Chrome for Developers — Modern Web Guidance v1](https://developer.chrome.com/blog/modern-web-guidance-v1?hl=zh-cn)。

## 设计 token 与应用壳层

- `src/app/globals.css` 是 shadcn 语义色、字体和圆角 token 的唯一代码来源。组件使用 `bg-background`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-primary` 等语义 utility，不散落原始颜色值。
- 基础主题使用 neutral。`--chart-*` 仅供有来源和时效标注的真实或 Fixture 图表使用；状态必须有文字，不以红绿颜色单独表达行情方向或验证状态。
- `font-sans` 和 `font-heading` 使用系统字体栈，优先可用的简体中文字体并保留系统回退；本地运行和构建不得依赖远程字体请求。
- 字级沿用 Tailwind 语义尺度：页面标题 `text-2xl`/`text-3xl`、区块标题 `text-base`、正文 `text-sm`、辅助说明 `text-xs`。数值列在对应数据页面使用等宽数字样式。
- 间距沿用 Tailwind v4 的 0.25rem 基准阶梯，布局使用 `gap-*`、`p-*` 与逻辑方向属性；圆角只通过 `--radius` 派生的 radius tokens 调整。
- 应用壳层使用 shadcn `Sidebar` 和单一 `<main>`。仅已实现的页面使用可导航链接；待开放模块显式标注状态，不渲染空链接。窄屏导航应可通过可见按钮打开和关闭。
- 每页仅一个 `<h1>`，跳过链接定位到带 `tabIndex={-1}` 的页面标题；导航用 `aria-current="page"` 标示当前位置。焦点状态须在常规和 forced-colors 模式下清晰可见。
- 空数据统一使用 shadcn `Empty` 和文字状态。无已验证行情或研究结果时显示 `NOT_VERIFIED`，不生成示例价格、胜率或模拟收益。

## 产品界面原则

- 默认使用简体中文；股票、货币、时区、采集时间和市场时间应明确标注。
- 产品作为即开即用的本地工具，不展示登录、注册或用户管理流程；开发执行器的 CLI 认证不属于应用界面。
- 组件基线采用 shadcn/ui，并沿用其 Tailwind 样式与组件约定；优先组合现有组件，只为研究领域交互补充必要的自定义组件，避免另造一套通用按钮、表单、弹窗等基础控件。
- 作为本地研究工作台，优先呈现可读的数据表、来源与研究状态；避免无意义的装饰卡片和伪实时视觉。
- 每个外部数据视图应表达来源、采集时间、市场时间及真实/延迟/历史/Fixture 状态。不可核验时明确显示 `NOT_VERIFIED`，不得用示例行情伪装真实数据。
- 纸面模拟和研究页面不得暗示真实下单、证券账户连接或自动收益承诺。
- 桌面布局可提高信息密度；窄屏应保持阅读顺序、关键状态和主要操作可用，不依赖悬停才能完成任务。

## 现代 Web 指南流程

UI、CSS 或客户端 JavaScript 开发前，先阅读仓库内的 `.agents/skills/modern-web-guidance/SKILL.md`。对具体能力执行有针对性的 `search`，阅读匹配的 `retrieve` 指南，再把相关建议适配到 React、Next.js 与本项目现有组件；不要把互不相关的指南硬套到功能上。

默认以 Baseline Widely available 能力作为无回退方案。采用更晚进入 Baseline 的能力时，按相应指南实现兼容回退，除非项目明确记录了不同的浏览器支持策略。优先使用合适的原生 HTML/CSS/DOM 能力，避免仅为模拟平台已有能力而加入 JavaScript 或依赖。

## 交互与质量要求

- 使用语义正确的 HTML；主要功能可用键盘完成，并提供清晰、可见的焦点状态。
- 表单控件应有可访问名称；校验错误需关联输入项并用文字说明，不能只依赖颜色。
- 尊重减少动态效果偏好；动效不能阻挡输入、阅读或状态变化。
- 颜色和状态标识保持足够对比度，并同时使用文字或图标传达状态。
- 保持页面稳定，避免内容加载导致明显布局跳动；长列表和非首屏内容按相关指南控制渲染成本。
- 把远程或导入文本视为不可信数据，不直接注入未经消毒的 HTML；凭据只保留在服务端或本地可信边界内。
- UI 变更按任务验收要求检查窄屏、键盘路径、焦点、空态、错误态和数据时效；不以静态截图替代交互验证。
