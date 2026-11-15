# Agent context engineering / NVIDIA compact-handoff policy

## Source and scope

Primary source: Peter Belcak et al., NVIDIA, _You don't need long context_, arXiv:2611.05306 (3 Nov 2026), https://arxiv.org/abs/2611.05306 .
The supplied ChatGPT share URL is supplementary discussion; this policy is based on the cited primary paper and our engineering interpretation, not a claim that the paper directly validated this repository's Codex runner.

## Principle

Persist semantic state rather than an unbounded transcript. EoCC (threshold compaction) and SAC (one action per context) are compared in the paper; neither guarantees accuracy in every task or proves Codex SDK implements it automatically. Adopt bounded task scope and verified handoffs as default; benchmark optional SAC separately.

## State and evidence model

- GitHub Issue: authoritative objective and acceptance conditions; the main commit and CI run record delivery evidence.
- `docs/DEVELOPMENT_PLAN.md`: stages, dependencies and phase gates.
- `harness/state/current.md`: single-writer resumable pointer to current Issue, branch, latest verified checkpoint and next action.
- `harness/handoffs/<ISSUE_ID>.md`: six-field compact handoff; reviewable but not a substitute for source evidence.
- `harness/logs/`: command transcripts and test evidence referenced by path/line; never paste full logs into model input.
- `docs/decisions/`: lasting ADRs and explicit alternatives/rejected assumptions.
- `harness/tasks.json`: structured machine state, with atomic writes and monotonic status transitions.

## Codex task executor

Run one controlled backlog item from the repository root with `pnpm autopilot --task P00-03`. The executor reads task scope, acceptance, and dependencies from `docs/backlog/*.json`; runtime task state follows `harness/tasks.schema.json`. A task is runnable only after every dependency is `DONE`. `DONE` is terminal and is skipped on later invocations.

The executor holds `harness/state/autopilot.lock` for one writer, recovers a lock only when its recorded process has exited, writes state through same-directory temp files and rename, and marks interrupted `RUNNING` tasks `PENDING` for inspection and resume. Each Codex turn has a 30-minute overall task deadline and at most three repair turns. It records command names, real exit codes, status, and duration in `harness/logs/<task>-<run-id>.json`; raw command output and prompts are not persisted. These execution records are local and ignored by Git.

The runner checks local `codex login status` before starting; it passes a minimal environment to the SDK and uses the user's existing Codex home. The SDK agent gets a named permission profile limited to this workspace, `.env` paths are denied, Git metadata and task-state files are read-only, command network access and web search are disabled, and approvals never grant more access. Missing or unverifiable login is `BLOCKED_EXTERNAL`; market/news data is never fetched by the executor, and fixture-based work must keep fixtures clearly labeled. Hosted Codex inference still requires service connectivity; no credentials or unavailable service must fail closed rather than be represented as offline success.

## EoCC and selective context construction

The default applies EoCC's compact-state-and-resume pattern at task and restart boundaries. Each invocation starts a fresh SDK thread and reconstructs its context from the exact selected backlog task, the complete `AGENTS.md`, `harness/state/current.md`, and only the matching task handoff plus handoffs for direct dependencies. Full conversation and command output are not copied into the new context; handoffs point back to durable files, which are retrieved by path or a narrow range when needed. The same-thread repair turns remain within the bounded task invocation; no automatic mid-task threshold compaction is claimed.

The SDK exposes per-turn input/output usage counts, but not the selected model's context-window limit. The runner records usage for later calibration and does not hardcode a token threshold from the paper's experiments. If a future SDK exposes reliable model limits, tune an in-task threshold from those limits and observed usage. SAC is not a default mode; evaluate it separately in the planned P08-05 experiment.

## Handoff schema

**Objective:** Issue ID + link; original acceptance text never rewritten away.
**Established facts:** observed facts, paths and symbols, errors, sources, timestamp; hypotheses explicitly labeled.
**Applied changes:** file list, commits, status of each change.
**Verification:** executed commands, exit codes, checks, evidence locations, open failures.
**Dead ends:** failed attempts and why not to repeat.
**Remaining plan:** ordered work, exact immediate next action, completion test, blocking dependencies.

## Prompt construction and budgets

The task prompt preserves the selected backlog item's scope, deliverables and acceptance. The context constructor records its source paths and reads the complete safety policy, current pointer and only the task and direct-dependency handoffs. A handoff is an index, not proof: on resume inspect actual Git/files and rerun relevant checks before claiming completion. Keep original source files on disk. Do not infer missing or truncated output; preserve external data provenance and label hypotheses. Each runner invocation creates a fresh SDK thread from persisted files; tests cover reconstruction using temporary source files without requiring credentials. Do not assume the paper's 16K/12K example is an optimal or supported Codex setting.

## Validation scenarios

1. Short-context restart after modifying one file resumes from actual Git status without repeating finished work.
2. Truncated test log yields a targeted reread command rather than fabricated details.
3. Rejected approach appears in Dead ends and is not repeated without new evidence.
4. Prior safety constraints and current Issue acceptance remain intact across many compressions.
5. Simulated crash between code edit and state write is reconciled before re-execution.
6. No raw secrets, private credentials or unbounded external text are written into handoffs.
