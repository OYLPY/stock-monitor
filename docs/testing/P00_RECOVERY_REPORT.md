# P00 Recovery and Acceptance Report

Date: 2026-11-15

Tracking Issue: [#19 — P00 故障恢复与阶段验收](https://github.com/OYLPY/stock-monitor/issues/19)

Parent gate: [#1 — P00 工程初始化与可恢复自动执行框架](https://github.com/OYLPY/stock-monitor/issues/1)

## Scope and result

P00-05 injects recovery and failure cases into the local Autopilot runner and verifies a clearly labeled offline sample. The P00 parent gate also requires the local app to start, task state to recover safely, DONE work to be skipped, and failures to remain auditable.

The recovery tests and all local quality checks passed. The offline success path uses synthetic SDK events explicitly labeled `OFFLINE_FIXTURE_ONLY`; it does not represent a real model response, real command execution, or market data. A separate authenticated runner attempt was blocked before any command ran because the configured Codex model was unsupported for the account. The runner's current failure classifier now maps that provider response to `BLOCKED_EXTERNAL`. Since the controlled runner did not complete a real task, P00-05 and parent Issue #1 remain open under the documented external-blocker rule.

OpenAI's [Codex availability guidance](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) notes that model options depend on account and workspace access. The runner leaves the local model selection unchanged.

## Recovery evidence

`scripts/autopilot.test.ts` covers:

- An exited lock-owner process leaves a stale lock that a new run recovers; an active lock still rejects a concurrent writer.
- A persisted `RUNNING` task is reconciled before a missing-credentials check blocks safely. The runner performs no SDK turn in that no-credentials case.
- A `DONE` task is skipped with exit code 0, without changing `harness/tasks.json`, checking credentials, loading context, or starting a turn.
- Corrupt task JSON remains unchanged and the execution record is `FAILED` with runner exit code 1.
- Missing credentials and unsupported account models classify as `BLOCKED_EXTERNAL`. A timed-out turn remains a recorded failure; none of these paths can pass validation or become `DONE`.
- The offline SDK event fixture flows through `runCodexTurn` and `runWithRepairs`; its synthetic checks have exit code 0, and recorded command steps include durations. The fixture is not a claim that those commands were actually executed.
- Existing cases continue to cover repair limits, command exit-code gates, atomic state writes, and timeout behavior.

The live runner attempt is recorded locally at `harness/logs/P00-05-2292b770-bcb8-41ea-8abc-ec694c7dcf84.json` (ignored by Git). It verified CLI login status, then failed on the Codex turn with no `command_execution` events, no reported SDK usage, and runner exit code 1. A minimal CLI diagnostic, instructed not to use tools, received HTTP 400 `model_not_found` before a model result. No market/news source was used. The historical log predates the classifier fix and therefore retains its original `FAILED` classification.

## Local verification

| Command                                          | Result                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| `pnpm exec vitest run scripts/autopilot.test.ts` | exit 0; 15 tests passed                           |
| `pnpm format:check`                              | exit 0                                            |
| `pnpm lint`                                      | exit 0                                            |
| `pnpm typecheck`                                 | exit 0                                            |
| `pnpm test`                                      | exit 0; 3 files and 19 tests passed               |
| `pnpm build`                                     | exit 0; static `/` and `/_not-found` routes built |
| `pnpm dev` + `GET http://127.0.0.1:3000/`        | server ready; HTTP 200                            |

## Earlier P00 delivery evidence

| Issue                                                          | State  | Main commit                                | Quality CI                                                                                 |
| -------------------------------------------------------------- | ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [#15 P00-01](https://github.com/OYLPY/stock-monitor/issues/15) | Closed | `344d0d50c7e4227be91213ce7931a19380dbd744` | Included in subsequent successful P00-02 main validation                                   |
| [#16 P00-02](https://github.com/OYLPY/stock-monitor/issues/16) | Closed | `4ac2af371b6a9e548a216b5028bc0410081ec09f` | [Run #43680860132](https://github.com/OYLPY/stock-monitor/actions/runs/43680860132) passed |
| [#17 P00-03](https://github.com/OYLPY/stock-monitor/issues/17) | Closed | `d3ea2dbe182a24fd05cffa002335a63e67498913` | [Run #43686705004](https://github.com/OYLPY/stock-monitor/actions/runs/43686705004) passed |
| [#18 P00-04](https://github.com/OYLPY/stock-monitor/issues/18) | Closed | `1a07867d11a22f3bda0c5f0f54c4ea865ea6f20a` | [Run #43689552861](https://github.com/OYLPY/stock-monitor/actions/runs/43689552861) passed |

## Boundaries

- The product remains a local immediate-use tool with no app login, registration, or user management. Codex CLI authentication is only a developer-runner prerequisite.
- No live market/news source or real trading action was used by these tests.
- The offline fixture verifies event handling and acceptance gates only; it cannot replace authenticated end-to-end model execution. The current local Codex model configuration must be corrected before a real SDK turn can complete.

## Final main verification

Implementation commit `da74069cd6de3470d05803df041586e721ebeade` is on `main`; [Quality run #43692753061](https://github.com/OYLPY/stock-monitor/actions/runs/43692753061) passed. Issue #19 remains open as `BLOCKED_EXTERNAL` because the real controlled runner did not complete a task. P01-02 can proceed because its declared dependency, P01-01 / #20, is already closed.
