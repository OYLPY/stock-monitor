# P08-05 Context Evaluation

Status: FIXTURE_ONLY. This evaluates deterministic context construction and source-ID rejection; it does not measure language-model accuracy, tokenizer tokens, latency, cost or production SAC behavior.

## Method

- Full-history fixture: project persisted context plus 120 repeated synthetic history fragments and one untrusted-text sentinel.
- Project task/restart context: reconstructed through buildPersistedContext as an EoCC-like project baseline; the repository does not implement threshold-triggered compaction.
- SAC fixture: three synthetic one-action checkpoints, each reconstructed with the same context builder. This is not a production mode.
- Payload budget is UTF-8 bytes of the returned persisted context. It excludes model wrappers, task prompt serialization and tokenizer counts.
- EoCC/SAC terminology follows the paper's distinction: threshold-triggered compaction versus a fresh context per action. The project comparison is only its existing task/restart boundary context, not a production EoCC implementation.

## Results

- Full-history fixture: 1 context; total and peak 12871 UTF-8 bytes; required markers 14/14.
- Project task/restart context: 1 context; total and peak 2361 UTF-8 bytes; required markers 14/14.
- SAC fixture: 3 contexts; total 6343 UTF-8 bytes; peak 2124 bytes; markers per action 14, 14, 14/14.

Determinism: 3 runs, 1 distinct result; SHA-256 values: de2611eeb99c5269ed27b19d0e471ea9193b0d6ebdeaedf36fa1a8a4d79b3794, de2611eeb99c5269ed27b19d0e471ea9193b0d6ebdeaedf36fa1a8a4d79b3794, de2611eeb99c5269ed27b19d0e471ea9193b0d6ebdeaedf36fa1a8a4d79b3794.

Citation rule check: 1/1 known-source fixture claims accepted; 1/1 unknown-source fixture claims rejected. This is source-ID rule coverage, not semantic fact accuracy.

Untrusted history sentinel included in long-history fixture: true; omitted from project task/restart context and each SAC reconstructed context: true / true.

## Limits

No Codex or other model was called. No market data, live task, paper trade, real execution, token count or billed usage was produced. The repeated results establish deterministic file reconstruction only; they do not show that a model retains meaning or that a trading strategy has predictive value.

Primary method reference: [Belcak et al., You don't need long context, arXiv:2611.05306](https://arxiv.org/abs/2611.05306).
