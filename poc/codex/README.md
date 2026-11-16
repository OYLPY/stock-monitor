# Codex SDK local-auth PoC

This proof of concept checks the installed `@openai/codex-sdk` against a fixed response contract and isolated failure modes. It does not read project files or market data, call tools, or modify the repository.

## Run

```powershell
node --experimental-strip-types poc/codex/smoke.ts success
node --experimental-strip-types poc/codex/smoke.ts no-auth
node --experimental-strip-types poc/codex/smoke.ts offline
node --experimental-strip-types poc/codex/smoke.ts offline-host-stop
node --experimental-strip-types poc/codex/smoke.ts simulated-429
node --experimental-strip-types poc/codex/smoke.ts simulated-stream-error
node --experimental-strip-types poc/codex/smoke.ts simulated-auth-error
```

- `success` makes one real Codex request using the current user's saved local CLI authentication. It expects the JSON object `{"status":"READY"}`.
- `no-auth` points the CLI to a temporary empty `CODEX_HOME` and excludes API key/token environment variables. It expects an authentication failure.
- `offline` uses a temporary `CODEX_HOME`, a non-secret API-key placeholder, and a loopback endpoint that drops the connection. No external API request or saved credential is used in this mode.
- `offline-host-stop` uses the adapter's shared configuration and aborts on the first streamed failure, then asserts the loopback request bound.
- `simulated-429` uses the same isolated setup and returns a local HTTP 429 fixture. The pinned CLI reports the fixture as rate-limited; this is not a test of real account quota behavior.
- `simulated-stream-error` returns the documented flat Responses `error` SSE ending that the pinned CLI can otherwise retry as a disconnect.
- `simulated-auth-error` returns a local HTTP 401 with an invalid API key error.

Each run prints one sanitized JSON line containing the mode, outcome, elapsed time, event types, schema result, and a coarse error category. Local failure modes also report request counts grouped by URL path. The PoC never prints the prompt, response text, thread ID, environment values, or raw error. Each run has a 90-second timeout and makes one application-level SDK call without application-level retries. The shared production configuration selects a temporary `stock_monitor_openai` provider with `request_max_retries=0`, `stream_max_retries=0`, and WebSocket support disabled, while requiring normal Codex/OpenAI authentication. It also disables shell, exec, browser, apps, plugins, skill search, hooks, memories, multi-agent, auth elicitation, tool suggestions, image tools, workspace access, MCP servers, and unbounded connection retries. The PoC points that provider at loopback and uses a placeholder key only for local cases; disconnect, HTTP 429, flat SSE error, and HTTP 401 each made one `/v1/responses` request. The 429 fixture is classified as rate-limited. The bare SDK baseline with default provider settings made 37 requests on disconnect. Real quota, auth-refresh behavior, and remote cancellation remain `NOT_VERIFIED`.

The request uses `sandboxMode: "read-only"`, `networkAccessEnabled: false`, disabled web search, and no project directories. Codex CLI may retain its normal local session metadata under the configured `CODEX_HOME`; the PoC prompt and expected response contain no private data.

## Evidence limits

The success mode is the only real model call. The no-auth mode first confirms that the temporary `CODEX_HOME` is not logged in, then verifies that the SDK turn fails without writing to the working directory. In the observed run, the CLI status was `not_logged_in` and the SDK reported a coarse network error rather than an authentication-specific status; that server-side distinction remains `NOT_VERIFIED`. The offline and simulated-429 modes use only loopback. The 429 response is a local fixture, not an account quota test; real account limits, cancellation side effects, and remote request termination remain `NOT_VERIFIED`.
