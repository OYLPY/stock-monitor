# stock-monitor

## Quant Research Workbench

Local-first research workspace for US and Japanese equities. It stores research records in local SQLite and does not connect brokerage accounts or submit real orders.

## Requirements

- Node.js 22 LTS (`.nvmrc`)
- pnpm 11.25.0

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:3000>. Check the application with `pnpm lint`, `pnpm typecheck`, and `pnpm build`.

The application works offline without market-data credentials. The optional US EOD integration uses EODHD Free after you set your own `EODHD_API_TOKEN` in a server-side `.env.local` and restart the app; never use a `NEXT_PUBLIC_` variable or commit the key. Free access is limited to one year of daily history and 20 requests per day. It is not sufficient for multi-decade strategy validation or backtests. See [the research and risk guide](docs/USER_GUIDE.md) before using imported or provider data.

The application is an immediately usable local tool with no login or user management. The separate Autopilot developer runner requires a local Codex CLI login; that does not add authentication to the application.

## Autopilot

Run one backlog task from the repository root with `pnpm autopilot --task P00-03`. If the account cannot use the locally configured model, `--model <model>` selects a model for that run only and records the selection without changing the local Codex configuration. The runner requires a local Codex CLI login, records task state in `harness/tasks.json`, and writes per-run exit-code evidence under the ignored `harness/logs/` directory. It uses a single-instance lock, a 30-minute task timeout, and at most three repair turns. Missing login or unavailable Codex service is recorded as `BLOCKED_EXTERNAL`; the runner never widens permissions.
