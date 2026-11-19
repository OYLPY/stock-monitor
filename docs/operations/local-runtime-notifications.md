# 本机运行与通知指南

> Doc ID: DOC-0041 · 目录：[DOCUMENT_INDEX](../pmo/DOCUMENT_INDEX.md)

## 适用版本与触发条件

适用于本机开发或生产启动的 Next.js 应用与 Node Worker。自动启动适合需要在用户登录期间持续处理本机计划任务的场景；它不创建产品账号、系统服务账号或远程服务。

下述 Task Scheduler 与 LaunchAgent 配置均由用户按需手动创建；应用不会自动注册操作系统任务。

先在仓库目录安装依赖并构建：

```powershell
pnpm install --frozen-lockfile
pnpm build
```

应用通过 `scripts/local-app.ts start --hostname 127.0.0.1` 同时启动本机 Web 应用和独立 Worker。Worker 使用 `Asia/Tokyo` 计划；系统睡眠时任务处理暂停，系统关机、用户会话结束或应用进程停止时不会运行。启动应用并不代表行情源、模型或报告任务已验证可用。

## 通知渠道与限制

- 重大事件先按既有规则写入 SQLite；浏览器只读取已持久化通知，不触发市场扫描。
- `/tasks` 默认静默。开启「桌面通知」后，页面才会请求当前站点的浏览器权限；无授权时不显示系统通知。开关偏好保存在当前浏览器配置中，开关关闭会立即静默。
- 页面约每 30 秒读取一次新增记录。浏览器对后台页面可能节流；页面关闭后不显示系统通知，但 Worker 仍可在应用运行时写入队列。重新打开页面后仍能查看本机记录，不会补发页面关闭期间的旧系统通知。
- 浏览器、用户配置和站点 origin（协议、主机、端口）共同决定通知权限。固定使用 `http://127.0.0.1:3000`；开发服务器换端口或改用 `localhost` 后需为新 origin 单独授权。
- 此渠道没有 Service Worker、推送服务或云端投递，也不保证实时到达。只有重大事件规则选中并保存的新记录才会作为桌面通知展示；通知不代表行情覆盖充分、策略已验证或已发生模拟成交。

## Windows Task Scheduler

1. 使用当前 Windows 用户打开 PowerShell，执行 `where.exe node` 并记下 `node.exe` 的完整路径；确认该用户能在仓库目录运行 `pnpm start`。
2. 完成上面的依赖安装和构建后，打开 Task Scheduler，选择 **Create Task**。
3. 在 **General** 中命名为 `Quant Research Workbench`，选择 **Run only when user is logged on**，使用当前用户，不勾选最高权限。
4. 在 **Triggers** 新建 **At log on**，用户选择当前用户。
5. 在 **Actions** 新建 **Start a program**：
   - Program/script：`where.exe node` 查到的完整 `node.exe` 路径。
   - Add arguments：`--experimental-strip-types scripts/local-app.ts start --hostname 127.0.0.1`
   - Start in：仓库根目录的完整路径，例如 `D:\path\to\quant-research-workbench`。
6. 在 **Settings** 选择任务已运行时不启动新实例；可启用失败后延迟 1 分钟重试，最多 3 次。保存后手动运行一次，检查 **Last Run Result**，再访问 `http://127.0.0.1:3000/tasks`。

停止或禁用：在 Task Scheduler 结束/禁用该任务，或从当前终端用 Ctrl+C 停止手动启动的 `pnpm start`。只有一个应用实例应运行；不要通过删除 SQLite、队列或 Worker 锁恢复启动问题。

## macOS LaunchAgent

仅在当前用户登录会话内运行，不使用系统级 LaunchDaemon。先执行 `command -v node` 记下 Node 完整路径，并按前文完成依赖安装和构建。创建 `~/Library/LaunchAgents/com.oylpy.stock-monitor.plist`，将占位路径替换为当前用户的绝对路径：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.oylpy.stock-monitor</string>
    <key>ProgramArguments</key>
    <array>
      <string>/absolute/path/to/node</string>
      <string>--experimental-strip-types</string>
      <string>/absolute/path/to/quant-research-workbench/scripts/local-app.ts</string>
      <string>start</string>
      <string>--hostname</string>
      <string>127.0.0.1</string>
    </array>
    <key>WorkingDirectory</key><string>/absolute/path/to/quant-research-workbench</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/USER/Library/Logs/stock-monitor/stdout.log</string>
    <key>StandardErrorPath</key><string>/Users/USER/Library/Logs/stock-monitor/stderr.log</string>
  </dict>
</plist>
```

先创建日志目录，再加载并确认：

```sh
mkdir -p "$HOME/Library/Logs/stock-monitor"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.oylpy.stock-monitor.plist"
launchctl print "gui/$(id -u)/com.oylpy.stock-monitor"
```

访问 `http://127.0.0.1:3000/tasks`，并查看上述 stdout/stderr 文件。停止并卸载：

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.oylpy.stock-monitor.plist"
```

登录会话结束或 Mac 关机后 Agent 不运行；睡眠时 Worker 暂停。`KeepAlive` 会在应用进程退出后尝试重启；若配置持续失败，先卸载 Agent、在终端查看实际错误，修复后再加载。

## 观察症状与诊断步骤

- 页面打不开：确认应用进程正在运行、访问的端口与启动命令一致，再从终端运行 `pnpm start` 查看实际错误。
- Worker 未运行：检查系统任务最后运行结果，或查看 LaunchAgent 的 stderr；不要启动第二份 Worker。
- 桌面通知未出现：确认 `/tasks` 页面仍打开、开关开启、当前 origin 的浏览器通知权限为允许。查看本机通知列表；队列记录存在但系统通知未显示，说明投递受浏览器/操作系统限制。
- 迁移报错：先保留数据库与自动生成的迁移前 SQLite 快照；不要手工改 `schema_migrations`、删除数据库或回退迁移文件。按[备份与恢复手册](backup.md)检查可用快照，再依据具体错误修复。

## 安全恢复步骤

1. 停止重复的 Task Scheduler/LaunchAgent 实例。
2. 从终端在仓库根目录运行 `pnpm start`，记录完整错误码和应用版本。
3. 对迁移问题先复制并校验快照，不覆盖当前数据库；按[备份与恢复手册](backup.md)预检后仅恢复到新路径。
4. 修复原因后再启动单一实例，确认任务页与 Worker 状态可读。

## 成功判据与失败回退

成功时，`http://127.0.0.1:3000/tasks` 可打开，Worker 状态来自本机租约；桌面通知开关默认关闭，只有显式授权后才开启。页面关闭、浏览器节流、系统休眠或关机期间没有系统通知送达保证；本机 SQLite 已保存的队列记录仍按原状态读取。

若应用、Worker、浏览器权限或来源不可用，停止系统任务并在终端检查；通知状态不能替代任务状态或来源覆盖状态。缺少可信市场证据时，系统继续显示 `NOT_VERIFIED`，不得据此生成实时行情信号、策略候选或模拟成交。

## 数据影响与不可逆操作

自动启动不更改数据库或账户。版本升级首次启动新迁移时，应用会先生成在线 SQLite 快照；迁移历史只追加，不重置账本、任务、通知或来源数据。本指南不要求真实交易、账户连接、云服务、付费服务或自动下单。

## 证据与关联 Issue

- Issue：[P11-05 本地通知渠道与持续运行指南](https://github.com/OYLPY/stock-monitor/issues/73)
- 相关设计：[调度与事件通知契约](../design/SCHEDULER.md)、[API/DTO 契约](../design/API_CONTRACTS.md)、[SQLite Schema](../design/DB_SCHEMA.md)、[用户使用指南](../USER_GUIDE.md)、[备份与恢复手册](backup.md)
