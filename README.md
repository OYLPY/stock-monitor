# stock-monitor

## Quant Research Workbench

Local-first research workspace for US and Japanese equities. The current P00 scaffold does not provide market data or trading features yet.

## Requirements

- Node.js 22 LTS (`.nvmrc`)
- pnpm 11.25.0

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. Check the scaffold with `pnpm lint`, `pnpm typecheck`, and `pnpm build`.

The P00 scaffold is static and works without credentials or market data. Copy `.env.example` only when a later task documents required variables. Quality checks are `pnpm format:check` and `pnpm test`.

The application is an immediately usable local tool with no login or user management. The separate Autopilot developer runner requires a local Codex CLI login; that does not add authentication to the application.

## Autopilot

Run one backlog task from the repository root with `pnpm autopilot --task P00-03`. If the account cannot use the locally configured model, `--model <model>` selects a model for that run only and records the selection without changing the local Codex configuration. The runner requires a local Codex CLI login, records task state in `harness/tasks.json`, and writes per-run exit-code evidence under the ignored `harness/logs/` directory. It uses a single-instance lock, a 30-minute task timeout, and at most three repair turns. Missing login or unavailable Codex service is recorded as `BLOCKED_EXTERNAL`; the runner never widens permissions.
