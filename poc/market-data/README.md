# Market-data offline PoC

This P04-03 PoC validates the offline evidence boundary only. Its OHLCV-shaped sample is synthetic, and the source identifier, symbol, `FIXTURE` data status, and `DEMO_ONLY` verification level prevent it from being presented as an actual quote.

## Run

```powershell
node --experimental-strip-types poc/market-data/smoke.ts
```

The smoke check requires no API key, reads no credential values, and makes no external request. It prints the expected `UNAVAILABLE` / `BLOCKED_EXTERNAL` state for an EDINET v2 check when no credential is supplied to the offline PoC. The provider probe is explicitly `NOT_RUN`; this does not test an EDINET adapter or infer whether credentials exist on the machine. The separately tagged synthetic fixture is used only for offline parsing checks.

The source-by-source availability, terms, latency, limits, timestamps, and cost findings are in [data-sources.md](../../docs/research/data-sources.md). This PoC does not prove a live provider connection, data license, API rate limit, or product integration.
