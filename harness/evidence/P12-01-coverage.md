# P12-01 Unit Coverage Report

- Generated: 2026-11-18
- Command: `corepack pnpm test:coverage`
- Result: exit 0; 6 test files and 57 tests passed.
- Provider: Vitest V8, local only. The report is not uploaded to a cloud service.
- Scope: the six source modules listed below; no coverage threshold was changed.

| Source module                                     | Statements |   Branches |  Functions |      Lines |
| ------------------------------------------------- | ---------: | ---------: | ---------: | ---------: |
| `src/domain/primitives.ts`                        |     91.95% |     89.39% |       100% |     95.06% |
| `src/features/market-calendar/market-calendar.ts` |     90.00% |     90.32% |       100% |     95.23% |
| `src/features/risk/checker.ts`                    |     78.94% |     62.96% |     88.88% |     81.27% |
| `src/features/risk/drawdown.ts`                   |     62.27% |     52.14% |     70.00% |     64.33% |
| `src/features/quant/indicators.ts`                |     90.58% |     77.33% |     97.05% |     93.08% |
| `src/features/evidence/repository.ts`             |     88.61% |     76.92% |     92.59% |     93.10% |
| **Total**                                         | **82.40%** | **70.64%** | **89.63%** | **85.30%** |

The total is limited to the configured modules; it is not whole-application coverage. Uncovered branches remain visible in the command output and are not hidden by a lowered threshold.

## Acceptance mapping

| Invariant                                                  | Test evidence                         |
| ---------------------------------------------------------- | ------------------------------------- |
| TSE lunch and NYSE DST/session boundaries                  | `tests/unit/market-calendar.test.ts`  |
| JPY integer precision and New York DST conversion          | `tests/unit/primitives.test.ts`       |
| Exact 2% risk budget and rejection above the allowed lot   | `tests/unit/risk-checker.test.ts`     |
| Exact 20% drawdown boundary across equity scales           | `tests/unit/drawdown.test.ts`         |
| ATR seed/Wilder smoothing and missing-session window reset | `tests/unit/indicators.test.ts`       |
| Stable event fingerprints and changes to identity fields   | `tests/unit/event-repository.test.ts` |

All market and event samples are fixtures. This report does not claim verified live or historical market data.
