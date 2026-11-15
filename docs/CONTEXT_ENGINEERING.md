# Agent context engineering / NVIDIA compact-handoff policy

## Source and scope
Primary source: Peter Belcak et al., NVIDIA, *You don't need long context*, arXiv:2611.05306 (3 Nov 2026), https://arxiv.org/abs/2611.05306 .
The supplied ChatGPT share URL is supplementary discussion; this policy is based on the cited primary paper and our engineering interpretation, not a claim that the paper directly validated this repository's Codex runner.

## Principle
Persist semantic state rather than an unbounded transcript. EoCC (threshold compaction) and SAC (one action per context) are compared in the paper; neither guarantees accuracy in every task or proves Codex SDK implements it automatically. Adopt bounded task scope and verified handoffs as default; benchmark optional SAC separately.

## State and evidence model
- GitHub Issue/PR: authoritative objective, acceptance conditions, review history.
- `docs/DEVELOPMENT_PLAN.md`: stages, dependencies and phase gates.
- `harness/state/current.md`: single-writer resumable pointer to current Issue, branch, latest verified checkpoint and next action.
- `harness/handoffs/<ISSUE_ID>.md`: six-field compact handoff; reviewable but not a substitute for source evidence.
- `harness/logs/`: command transcripts and test evidence referenced by path/line; never paste full logs into model input.
- `docs/decisions/`: lasting ADRs and explicit alternatives/rejected assumptions.
- `harness/tasks.json`: structured machine state, with atomic writes and monotonic status transitions.

## Handoff schema
**Objective:** Issue ID + link; original acceptance text never rewritten away.
**Established facts:** observed facts, paths and symbols, errors, sources, timestamp; hypotheses explicitly labeled.
**Applied changes:** file list, commits, status of each change.
**Verification:** executed commands, exit codes, checks, evidence locations, open failures.
**Dead ends:** failed attempts and why not to repeat.
**Remaining plan:** ordered work, exact immediate next action, completion test, blocking dependencies.

## Prompt construction and budgets
Each invocation includes safety policy + exact current task + handoff + bounded code excerpts. Read by filename/keyword/line range; expand only when necessary. Keep original source files on disk. Configure compaction threshold from model limits and observed costs; never assume 16K/12K is an optimal or supported Codex setting. Preserve external data provenance and distinguish stale memory from verified current state. Validate handoff/resume accuracy by replay tests and compare outcomes and costs to noncompacted baseline.

## Validation scenarios
1. Short-context restart after modifying one file resumes from actual Git status without repeating finished work.
2. Truncated test log yields a targeted reread command rather than fabricated details.
3. Rejected approach appears in Dead ends and is not repeated without new evidence.
4. Prior safety constraints and current Issue acceptance remain intact across many compressions.
5. Simulated crash between code edit and state write is reconciled before re-execution.
6. No raw secrets, private credentials or unbounded external text are written into handoffs.
