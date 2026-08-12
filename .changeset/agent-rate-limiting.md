---
'@larkup/agent-contracts': minor
'@larkup/agent-widget': patch
'@larkup/core': minor
'larkup': patch
---

feat(agent-runtime): rate limiting on browser-facing Agent endpoints (plan §8.5)

Closes the one remaining launch blocker in TASK 08: the `allowedOrigins`
allow-list answered *who* may call an agent, not *how much* — an
allow-listed page with a loop, or a scraped snippet replayed from a headless
browser, could spend the operator's model budget with nothing to stop it.

**New in `@larkup/agent-contracts`**: `rate-limit.ts` — a `RateLimiter`
interface plus `MemoryRateLimiter`, a token-bucket implementation (mirroring
`IdempotencyStore`'s in-memory-by-default shape from `@larkup/channels-core`).
Backs three limits:

- **Requests/minute per visitor** (`hash(agentId + IP + UA)`, burst 5,
  sustains 20/min) — checked in `authorizeAgentRequest`, immediately after
  the origin check, so it covers every browser-facing agent endpoint.
- **Messages/session** (50, no refill within a session).
- **Daily token ceiling per agent** — operator-set, off by default. A raw
  token count rather than a dollar figure: there is no per-model pricing
  table in the codebase yet, so this reports what the runtime actually
  knows (`usage.totalTokens` from `onFinish`) rather than inventing a
  pricing model. Configurable in the dashboard's agent Connect dialog.

Denials are `429` with `Retry-After` and `X-RateLimit-Remaining`, carrying
CORS headers so a blocked browser reports the reason instead of an opaque
`Failed to fetch`.

`@larkup/core`'s `streamAgentChatResponse` gains an optional `onUsage`
callback so `apps/web` can charge the daily ceiling without `packages/core`
depending on anything in `apps/web`. The generated Agent Runtime bundle
(`agent-runtime-server.ts` → `server.mjs`) mirrors the same three checks in
plain JavaScript, extending the existing origin-matcher/wire-protocol
duplication rather than inventing a new seam.

`@larkup/agent-widget` maps a `429` from `/chat` to a fixed message, "Too
many messages — try again in a minute," regardless of which of the three
limits tripped.

See [ADR-011](docs/adrs/adr-011-agent-rate-limiting.md) for the full design
and the identity/trust-boundary reasoning (`X-Forwarded-For`'s last hop
only, no cookie or fingerprint).
