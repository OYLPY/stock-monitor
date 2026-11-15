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
