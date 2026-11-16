# P04-04 Worker lifecycle PoC

This offline PoC checks that a persisted task can outlive both its browser page and the Next.js server, and that a restarted Node Worker recovers without duplicating its local effect record.

## Requirements

- Node.js 22.14 or newer, matching the repository engine requirement.
- Install the repository dependencies with `pnpm install --frozen-lockfile` from the repository root.

## Run

From the repository root:

```sh
node --experimental-strip-types poc/worker/smoke.ts
node --experimental-strip-types poc/worker/browser-harness.ts
```

The smoke check kills child Workers at four persisted checkpoints, restarts them, and checks idempotency, lease fencing, API validation, and a simulated missed window. It prints a `browser_ready` JSON line with a loopback URL and keeps stdin open.

For the browser check, open that URL in a browser, submit **启动持久任务**, then close the tab. Enter `browser-closed` in the harness terminal and press Enter. The harness stops the Next.js server, then verifies that the independent Worker heartbeat advances and the task becomes `DONE` with exactly one local effect row. Both runs append evidence to `actual-run-2026-11-16.jsonl`.

All data stays in a temporary SQLite database under the OS temp directory. The PoC makes no external requests, reads no credentials, and uses no market data. The effect ledger is local SQLite state; it does not prove exactly-once delivery to an external service.

## Runtime and startup limits

The offline missed-window check advances timestamps to simulate a process gap. It is not a real sleep, shutdown, power-loss, or restart test. This Windows run did not exercise macOS startup behavior. The source comparison in [DOC-0037](../../docs/research/p04-04-worker-runtime-findings.md) is guidance for later packaging work, not an installed startup configuration.
