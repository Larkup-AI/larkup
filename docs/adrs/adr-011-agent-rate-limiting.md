# ADR-011: Agent Rate Limiting

**Status:** Accepted
**Date:** 2026-08-12
**Decision makers:** Product owner, maintainers
**Closes:** plan §8.5 (launch blocker); the "Rate limiting and abuse controls"
follow-up named in ADR-009's consequences.

## Context

ADR-009 settled *who* may call an agent: the `allowedOrigins` allow-list,
enforced before any work happens. It said nothing about *how much*. One
allow-listed page with a loop, or a scraped snippet replayed from a headless
browser, spends the operator's model budget until the provider's own quota
stops it — indefinitely, since a self-hosted operator's provider account has
no Larkup-side ceiling at all. That gap is why plan §8.5 is marked the one
launch blocker in TASK 08's remaining work: everything else is a target or a
convenience; this one bounds money.

## Decision

### Three limits, one primitive

| Limit | Scope | Default | Catches |
| --- | --- | --- | --- |
| Requests/minute | visitor (`hash(agentId + IP + UA)`) | burst 5, sustains 20/min | A loop or a scripted client. |
| Messages/session | same visitor key (no session id exists yet — see below) | 50, no refill | One visitor grinding a conversation. |
| Daily token ceiling | agent | operator-set, **off by default** | The bill — the only one of the three that bounds money rather than traffic. |

All three are the same **token bucket** (`packages/agent-contracts/src/rate-limit.ts`),
sized differently, keyed differently. One primitive rather than three because a
fixed window lets a caller spend a whole window's budget in the first second
and again at the boundary; a token bucket refills smoothly and can report an
honest `Retry-After`. `MemoryRateLimiter` mirrors the shape of
`IdempotencyStore` in `packages/channels-core` on purpose: process-local by
default, an interface everywhere else, so a shared Redis/Postgres
implementation swaps in later (TASK 09's control-plane store) without
touching a call site.

`consume(key, cost, config)` gates work whose cost is known up front (a
request, a message) — a denied attempt spends nothing, so the caller can
retry cleanly after `retryAfterSeconds`. `charge(key, cost, config)`
unconditionally records a spend, letting the balance go negative — this
exists *only* for the token ceiling, because a run's actual cost is not known
until `onFinish` reports `usage`, after the run already happened. There is
nothing to gate at that point; the run that caused the overshoot still
finishes, and the *next* `consume` precheck is what starts denying.

### No dollar cost — a token ceiling

Plan §8.5 calls the third limit a "token/cost ceiling." There is no
per-model pricing table anywhere in the codebase (`chat-models/registry.ts`
has model ids, not prices), so a real dollar figure would mean inventing and
maintaining one — a metering/billing concern that belongs with TASK 09, not
with this. `AgentDefinition.dailyTokenCeiling` is a raw token count, fed
directly by `usage.totalTokens` from `streamText`'s `onFinish`, which is
honest about what the runtime actually knows.

### Where each check lives

- **Requests/minute** — `apps/web/lib/agent-access.ts`'s `authorizeAgentRequest`,
  immediately after the origin check, before auth. It therefore covers every
  browser-facing endpoint an agent has (`/chat`, `/public`), not only chat —
  a scraped-loop hitting the cheap config endpoint is still a loop.
- **Messages/session and the daily ceiling** — the chat route
  (`apps/web/app/api/agents/[agentId]/chat/route.ts`) directly, because only a
  chat turn has a "message" to count or a run whose usage to charge.
- **The generated bundle** (`packages/core/src/generator/agent-runtime-server.ts`)
  mirrors the same logic in plain JavaScript, in the same place in its request
  handler — the "known debt" duplication ADR-009 and the plan's generator
  section already accept for the origin matcher and wire protocol, extended
  here rather than invented new. `agent-runtime-bundle.spec.ts` asserts the
  generated `server.mjs` contains the mirrored functions.

### Visitor identity: same imprecision as ADR-009's origin check, not new

No cookie, no fingerprint — the widget carries neither (ADR-004). A visitor is
`hash(agentId + IP + User-Agent)`. `X-Forwarded-For` is trusted only at its
**last hop** — the entry the immediate reverse proxy itself appended, which a
client cannot spoof, versus the first entry, which is client-supplied and
trivially forged. Every supported deployment (Caddy on Docker/VPS, Vercel's
edge in front of the dashboard) is exactly one trusted hop, so this needs no
per-deployment configuration.

The widget has no session id at all (`use-agent-chat.ts`'s transcript lives
only in a `useRef`, deliberately not persisted — see that file's doc comment).
Messages/session therefore falls back to the same visitor key the
requests/minute limit uses. This is not a new weakening: it is the identical
shared-NAT imprecision plan §8.5 already accepts for the requests/minute
limit. A channel turn *does* have a real session
(`channelId:conversationId`, `packages/core/src/session-store.ts`) and passes
it through as a precise bucket key instead.

### Response shape

`429`, `Retry-After` (seconds), `X-RateLimit-Remaining`, and a denial that
still carries CORS headers — same reasoning as ADR-009's origin denials:
without `Access-Control-Allow-Origin` on the response, the browser hides a 429
behind an opaque `TypeError: Failed to fetch`. The widget maps every 429 to
one fixed message, "Too many messages — try again in a minute," regardless of
which of the three limits tripped — a visitor cannot act on the difference,
and an operator has the headers and server logs for that.

### Explicitly not built

CAPTCHA, IP reputation, a WAF. Plan §8.5 places those with the hosted control
plane (TASK 09) and the CDN in front of it — a self-hosted, single-process
deployment has no use for them and no infrastructure to run them against.

## Consequences

**Positive**

- Closes the one launch blocker named in TASK 08 and in ADR-009's
  follow-up list.
- One tested primitive (`rate-limit.test.ts`, 20 cases) backs all three limits
  and both runtime implementations, rather than three bespoke ones.
- `dailyTokenCeiling` is off by default — a self-hosted operator who never
  opens the setting gets no new behavior change.

**Negative**

- In-memory buckets are per-process: two replicas each allow the full rate.
  Correct for the supported single-container self-hosted target; wrong for a
  scaled deployment. Same seam, same fix as `IdempotencyStore` and the channel
  session store — land once on the control-plane Postgres in TASK 09, not
  three more times.
- Messages/session shares the requests/minute visitor key for the widget path
  specifically because there is no real session id yet. A shared corporate NAT
  undercounts distinct visitors on both limits identically, not just one.
- A token ceiling is not a dollar ceiling. An operator setting
  `dailyTokenCeiling` is bounding a proxy for spend, not spend itself, until a
  pricing table exists.
