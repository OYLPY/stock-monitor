# Codex SDK local-auth PoC

This proof of concept checks the installed `@openai/codex-sdk` against a fixed response contract and two isolated failure cases. It does not read project files or market data, call tools, or modify the repository.

## Run

```powershell
node --experimental-strip-types poc/codex/smoke.ts success
node --experimental-strip-types poc/codex/smoke.ts no-auth
node --experimental-strip-types poc/codex/smoke.ts offline
node --experimental-strip-types poc/codex/smoke.ts offline-host-stop
node --experimental-strip-types poc/codex/smoke.ts simulated-429
```

- `success` makes one real Codex request using the current user's saved local CLI authentication. It expects the JSON object `{"status":"READY"}`.
- `no-auth` points the CLI to a temporary empty `CODEX_HOME` and excludes API key/token environment variables. It expects an authentication failure.
- `offline` uses a temporary `CODEX_HOME`, a non-secret API-key placeholder, and a loopback endpoint that drops the connection. No external API request or saved credential is used in this mode.
- `offline-host-stop` applies a candidate host policy that aborts the SDK turn on the first streamed network error, then asserts that no more than three loopback requests were made.
- `simulated-429` uses the same isolated setup and returns a local HTTP 429 fixture. It checks SDK error classification and automatic retry behavior; it does not validate real account quota semantics.

Each run prints one sanitized JSON line containing the mode, outcome, elapsed time, event types, schema result, and a coarse error category. Local failure modes also report request counts grouped by URL path. The PoC never prints the prompt, response text, thread ID, environment values, or raw error. Each run has a 90-second timeout and makes one application-level SDK call without application-level retries; the CLI may retry internally. The SDK receives `features.unbounded_connection_retries=false`. With a temporary `CODEX_HOME` and a non-secret key that only reaches loopback, the bare offline run still made 37 `/v1/responses` requests before failing, so it fails the three-attempt NFR-004 bound. The candidate host-stop policy aborted after the first streamed network error at three requests and passed the bound for this connection failure. A separate run using the local 429 fixture made two `/v1/responses` requests and surfaced as `network_unavailable`, not `rate_limited`. These observations show that the bare SDK call cannot currently be relied upon for required task-level retry and quota behavior; the host-stop result is limited to the tested offline connection failure and does not establish actual account quota handling.

The request uses `sandboxMode: "read-only"`, `networkAccessEnabled: false`, disabled web search, and no project directories. Codex CLI may retain its normal local session metadata under the configured `CODEX_HOME`; the PoC prompt and expected response contain no private data.

## Evidence limits

The success mode is the only real model call. The no-auth mode first confirms that the temporary `CODEX_HOME` is not logged in, then verifies that the SDK turn fails without writing to the working directory. In the observed run, the CLI status was `not_logged_in` and the SDK reported a coarse network error rather than an authentication-specific status; that server-side distinction remains `NOT_VERIFIED`. The offline and simulated-429 modes use only loopback. The 429 response is a local fixture, not an account quota test; real account limits, cancellation side effects, and remote request termination remain `NOT_VERIFIED`.
