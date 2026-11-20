# P12-02 Integration Verification

- Date: 2026-11-20 (Asia/Tokyo)
- Issue: [P12-02 / #75](https://github.com/OYLPY/stock-monitor/issues/75)
- Implementation commit: [`9f0e63d`](https://github.com/OYLPY/stock-monitor/commit/9f0e63dc2fb804dbb679b16457264b4a418d83b1)
- Matching Quality CI: [44758467681](https://github.com/OYLPY/stock-monitor/actions/runs/44758467681) — success at 2026-11-21 00:00 JST; format, lint, typecheck, unit, build, and E2E all passed.
- Scope: isolated temporary SQLite databases and deterministic local `fetch` responses. No live provider request, user database, Worker, or Codex call was used. The fill replay test writes only a synthetic fill to a disposable test database, which is removed during teardown.

## Coverage

- `tests/integration/runtime-boundaries.test.ts`: two simultaneous report submissions with the same request ID resolve to one persisted task/event; the migrated database is closed and reopened before the stored task is checked.
- The same integration file exercises the US market-data route with invalid input, mocked disconnect, timeout, stale CSV, successful recovery, and HTTP 429. It checks the mapped HTTP states, one persisted bar after recovery, and absence of the test credential from responses, captured `console.error` calls, and persisted source/audit records.
- `src/features/paper/fill-engine.test.ts`: a paper fill replay after closing and reopening SQLite does not duplicate fills or ledger events; an expired quote produces no fill or ledger change.
- `src/features/alerts/alerts.test.ts`: notification replay after SQLite reopen does not create a duplicate notification.
- `src/db/db.test.ts`: a thrown transaction rolls back all writes; a competing writer returns `SQLITE_BUSY`, leaves the account absent, then succeeds after the lock is released.

All test quotes and provider responses are local test fixtures. They do not establish market-data quality, real strategy performance, a verified paper balance, or any real execution.

## Local verification

| Command                                       | Result                       |
| --------------------------------------------- | ---------------------------- |
| `corepack pnpm test:integration`              | exit 0; 1 file / 2 tests     |
| `corepack pnpm test`                          | exit 0; 57 files / 325 tests |
| `corepack pnpm format:check`                  | exit 0                       |
| `corepack pnpm exec eslint src scripts tests` | exit 0                       |
| `corepack pnpm typecheck`                     | exit 0                       |
| `corepack pnpm build`                         | exit 0                       |

The production build left the pre-existing `tsconfig.json` bytes unchanged. Local Playwright E2E was not run for this backend integration task; the matching remote Quality CI completed E2E successfully.

## Remaining gate

Implementation commit `9f0e63d` and its matching Quality CI are successful. Push the acceptance-record update, verify its CI, then post this evidence to #75 and close the Issue. No live EODHD access is part of this Issue; #49 remains independently blocked until its authorized credential and real-data validation are available.
