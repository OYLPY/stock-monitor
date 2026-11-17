# P00 Recovery and Acceptance Report

Date: 2026-11-18

Tracking Issue: [#19 — P00 故障恢复与阶段验收](https://github.com/OYLPY/stock-monitor/issues/19)

Parent gate: [#1 — P00 工程初始化与可恢复自动执行框架](https://github.com/OYLPY/stock-monitor/issues/1)

## Scope and result

P00-05 injects recovery and failure cases into the task-execution coordinator and verifies a clearly labeled offline sample. For final acceptance, Codex CLI was invoked directly with the available `gpt-5.6-sol` model, as instructed; no separate repository `pnpm autopilot` invocation was used. The P00 parent gate also requires the local app to start, task state to recover safely, DONE work to be skipped, and failures to remain auditable.

The recovery tests and all local quality checks passed. The offline success path uses synthetic SDK events explicitly labeled `OFFLINE_FIXTURE_ONLY`; it does not represent a real model response, real command execution, or market data. A previous `pnpm autopilot` attempt timed out after 30 minutes, but the direct Codex CLI acceptance run completed the read-only inspection and all required quality commands. The old timeout remains historical evidence and was not overwritten. The direct run used the authenticated Codex CLI model; it did not access any market or news source.

OpenAI's [Codex availability guidance](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) notes that model options depend on account and workspace access. The direct CLI call used the per-invocation `gpt-5.6-sol` selection and did not change global Codex configuration.

## Recovery evidence

`scripts/autopilot.test.ts` covers:

- An exited lock-owner process leaves a stale lock that a new run recovers; an active lock still rejects a concurrent writer.
- A persisted `RUNNING` task is reconciled before a missing-credentials check blocks safely. The runner performs no SDK turn in that no-credentials case.
- A `DONE` task is skipped with exit code 0, without changing `harness/tasks.json`, checking credentials, loading context, or starting a turn.
- Corrupt task JSON remains unchanged and the execution record is `FAILED` with runner exit code 1.
- Missing credentials and unsupported account models classify as `BLOCKED_EXTERNAL`. A timed-out turn remains a recorded failure; none of these paths can pass validation or become `DONE`.
- The offline SDK event fixture flows through `runCodexTurn` and `runWithRepairs`; its synthetic checks have exit code 0, and recorded command steps include durations. The fixture is not a claim that those commands were actually executed.
- Existing cases continue to cover repair limits, command exit-code gates, atomic state writes, and timeout behavior.

The previous failed execution is recorded locally at `harness/logs/P00-05-2292b770-bcb8-41ea-8abc-ec694c7dcf84.json` (ignored by Git). It verified CLI login status, then failed on the Codex turn with no `command_execution` events, no reported SDK usage, and exit code 1. A minimal CLI diagnostic received HTTP 400 `model_not_found` before a model result. The historical log predates the classifier fix and retains its original `FAILED` classification. The successful direct Codex CLI acceptance is recorded locally at `harness/logs/P00-05-direct-codex-acceptance.jsonl` (ignored by Git), thread `01a1ea23-9620-7503-860e-ffd7d642dd94`; it contains the actual command events and exit codes.

## Local verification

| Command                                          | Result                                |
| ------------------------------------------------ | ------------------------------------- |
| `pnpm exec vitest run scripts/autopilot.test.ts` | exit 0; 16 tests passed               |
| `pnpm format:check`                              | exit 0                                |
| `pnpm lint`                                      | exit 0                                |
| `pnpm typecheck`                                 | exit 0                                |
| `pnpm test`                                      | exit 0; 28 files and 151 tests passed |
| `pnpm build`                                     | exit 0                                |
| `pnpm dev` + `GET http://127.0.0.1:3000/`        | server ready; HTTP 200                |

Direct CLI acceptance: `codex exec --json --model gpt-5.6-sol --approve-for-me --ephemeral --ignore-user-config ... -` completed with exit 0, thread `01a1ea23-9620-7503-860e-ffd7d642dd94`. It inspected the named P00-05 files and executed each command separately. Recorded elapsed times: targeted recovery tests 1.147s; format 1.952s; lint 9.017s; typecheck 3.508s; full test suite 4.432s; build 6.750s. Each command exited 0. The direct CLI run made no tracked-file edits.

## Earlier P00 delivery evidence

| Issue                                                          | State  | Main commit                                | Quality CI                                                                                 |
| -------------------------------------------------------------- | ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [#15 P00-01](https://github.com/OYLPY/stock-monitor/issues/15) | Closed | `344d0d50c7e4227be91213ce7931a19380dbd744` | Included in subsequent successful P00-02 main validation                                   |
| [#16 P00-02](https://github.com/OYLPY/stock-monitor/issues/16) | Closed | `4ac2af371b6a9e548a216b5028bc0410081ec09f` | [Run #43680860132](https://github.com/OYLPY/stock-monitor/actions/runs/43680860132) passed |
| [#17 P00-03](https://github.com/OYLPY/stock-monitor/issues/17) | Closed | `d3ea2dbe182a24fd05cffa002335a63e67498913` | [Run #43686705004](https://github.com/OYLPY/stock-monitor/actions/runs/43686705004) passed |
| [#18 P00-04](https://github.com/OYLPY/stock-monitor/issues/18) | Closed | `1a07867d11a22f3bda0c5f0f54c4ea865ea6f20a` | [Run #43689552861](https://github.com/OYLPY/stock-monitor/actions/runs/43689552861) passed |

## Boundaries

- The product remains a local immediate-use tool with no app login, registration, or user management. The direct Codex CLI call used the existing developer authentication; it did not add product login or user management.
- No live market/news source or real trading action was used by these tests.
- The offline fixture verifies event handling and acceptance gates only; it does not claim real inference or market data. The direct Codex CLI acceptance performed a real model call and actual local shell-command execution, but did not exercise the repository autopilot entry point.

## Final main verification

P00-05 implementation commit `da74069cd6de3470d05803df041586e721ebeade` and model-selection correction `b0df8d74f4cedcfd11ef08bc73616f8da7aa400b` are on `main`; their Quality CI runs #43692753061 and #44109885176 passed. The direct Codex CLI acceptance and all checks also passed against `main` commit `1f323621a370a9964eac13922681b5319cb69fda`, with [Quality CI #44114474211](https://github.com/OYLPY/stock-monitor/actions/runs/44114474211) successful. The full acceptance evidence commit [`cf4676fe7d49b133c03fd5b53898205a5b7dbcee`](https://github.com/OYLPY/stock-monitor/commit/cf4676fe7d49b133c03fd5b53898205a5b7dbcee) passed [Quality CI #44117548907](https://github.com/OYLPY/stock-monitor/actions/runs/44117548907). A final task/index state-sync commit is pending its CI before #19 and #1 are closed.
