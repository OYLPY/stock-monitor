# P12-04 Quant Audit Evidence

- Generated: 2026-11-18
- Baseline: `c182fe965a90cbe7b5cfbd1555ac825c3df39527`
- Dataset: fixed synthetic replay vector in `tests/quant-audit/fixtures/replay-2020-2022.ts`; all prices, calendar, FX, coverage, cost, and settlement records are marked `FIXTURE` / `NOT_VERIFIED`.
- No repository historical OHLCV or verified FX evidence was used. The vector is for deterministic arithmetic and failure-gate verification only; it is not market history or strategy performance.

## Reproducible replay vector

| Output                                 | Expected value                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| Baseline input SHA-256                 | `fe90e8347ba96579669921f02cc6fc4e09e51d44da6934fec84bf6d3c6192100` |
| Baseline ending equity (fixture JPY)   | `1000500.00000000`                                                 |
| Adverse cost/FX scenario SHA-256       | `82a07ee02e1eb3baf009fd8e1a99b0f493120d847b0c317b4d5e07e6fb05bc6f` |
| Scenario fees (fixture JPY)            | `305.00000000`                                                     |
| Scenario ending equity (fixture JPY)   | `999663.00000000`                                                  |
| Execution status/date/quantity changed | `false`                                                            |

The same vector replays byte-for-byte to the same report. Raising costs for the same fills increases fees and lowers fixture equity. Changing an FX observation changes the scenario fingerprint. Both 2020 and 2022 windows keep `NOT_VERIFIED` with null historical metrics; fixture FX cannot validate either window.

## Verification

- `corepack pnpm test:quant-audit` — exit 0; 4 files / 39 tests.
- `corepack pnpm test` — exit 0; 36 files / 242 tests.
- `corepack pnpm format:check` — exit 0.
- `corepack pnpm lint` — exit 0.
- `corepack pnpm typecheck` — exit 0.
- `corepack pnpm build` — exit 0.
- `git diff --check` — exit 0.

No paid service, market-data API, coverage upload, or other cloud data service was used.
