# ADR-014: Slack Channel — the `url_verification` Handshake Boundary

**Status:** Accepted
**Date:** 2026-08-12
**Decision makers:** Product owner, maintainers
**Covers:** TASK 06 / plan §9, third channel after Webhook and Telegram (ADR-010).

## Context

Slack is next in plan §9's delivery order after Webhook and Telegram. Its
`verify()`/`parse()`/`send()`/`health()` map onto `ChannelAdapter`
(ADR-010 §1) exactly like the first two: HMAC-SHA256 signature (close enough
to the generic webhook's scheme to reuse its timing-safe compare and
replay-window reasoning), a message event to normalize, `chat.postMessage`
to deliver, `auth.test` to probe health.

One thing does not fit: Slack's Events API sends a one-time
`url_verification` request when an operator saves the Request URL in the
Slack app dashboard, and requires the exact `challenge` value it sent echoed
back in the response body. `dispatchInbound`'s result type is
`{ ok: boolean; error?: string; detail?: string }` (ADR-010 §1) — fixed on
purpose, so every provider answers through one shape. `{ challenge }` does
not fit it, and this is not a message, so there is nothing to dispatch.

## Decision

### Handle it at the inbound route, not in the shared contract

`slack.ts` exports a pure function, `slackUrlVerificationChallenge(body)`,
that recognizes the payload and returns `{ challenge }` or `null`. The
inbound route (`apps/web/app/api/agents/[agentId]/channels/[channelId]/route.ts`)
calls `adapter.verify()` explicitly — the same check `dispatchInbound` would
run — and if both that and the challenge check pass, answers directly and
never calls `dispatchInbound` at all. The generated bare-Node server
(`agent-runtime-server.ts`) mirrors the identical two-step check inline,
same as it already mirrors the origin matcher and wire protocol (plan's
known-debt note, ADR-009).

Rejected alternative: add an optional hook to `ChannelAdapter` (e.g.
`handleSpecial?(request)`) that any adapter could use for a custom response.
This would let every future channel author invent their own escape hatch
from the shared contract, which is exactly what plan §9's "one dispatch
pipeline" (ADR-010 §1) exists to prevent. A named, provider-specific
function that the route calls explicitly says what it is; a generic hook
invites hiding a whole second protocol behind it.

**Precedent for WhatsApp and Discord** (next in the delivery order): a
provider's one-time setup handshake is a route-level special case answered
*after* signature verification and *before* `dispatchInbound`, exported as a
named pure function from that provider's own adapter module — not a change
to the shared `ChannelAdapter` interface or the dispatcher's result type.

### Accepted, not solved: the 3-second ack SLA

Slack expects an HTTP response within 3 seconds or it retries the event.
`dispatchInbound` runs the whole agent turn synchronously — the same
trade-off Telegram already made. A slow model call means Slack retries
before this adapter has answered; the retry carries the same `event_id`,
which the shared idempotency store (ADR-010 §1) already de-duplicates. The
user sees one answer, arriving late rather than not at all, or duplicated.
Solving this properly (acknowledge immediately, reply asynchronously) is a
dispatcher-level change affecting every channel, not something specific to
Slack — out of scope here, and not new: Telegram already carries the
identical trade-off today.

## Consequences

**Positive**

- `ChannelAdapter` and `dispatchInbound` are unchanged — Slack is a pure
  addition, like Telegram was.
- The url_verification pattern is documented before WhatsApp or Discord need
  it, rather than each reinventing an answer under time pressure.

**Negative**

- A slow agent turn still risks a duplicate Slack delivery under retry,
  identical to Telegram's existing exposure. Not a regression, but not fixed
  either — tracked as the same dispatcher-level gap ADR-010 already named
  for the channel session and idempotency stores (TASK 09's shared
  control-plane store).
