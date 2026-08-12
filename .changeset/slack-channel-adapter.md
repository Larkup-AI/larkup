---
'@larkup/channels-core': minor
'@larkup/core': patch
'larkup': patch
---

feat(channels): Slack channel adapter (plan §9, third after Webhook and Telegram)

`packages/channels-core/src/adapters/slack.ts` — `verify`/`parse`/`send`/`health`
against the shared `ChannelAdapter` contract, no changes to the contract
itself:

- `verify`: Slack's `X-Slack-Signature: v0=<hex>` over `v0:{timestamp}:{rawBody}`,
  HMAC-SHA256, timing-safe compare, 5-minute replay window — the same shape
  as the generic webhook channel's scheme.
- `parse`: normalizes a `message` event, ignoring anything with a `subtype`
  (edits, deletes, bot relays) or a `bot_id` (never answer another bot — two
  bots would loop forever). Keys idempotency on Slack's `event_id`, which is
  stable across the retries a slow reply causes.
- `send`: `chat.postMessage`, checking the JSON body's `ok` field rather than
  the HTTP status — Slack's Web API answers 200 even on failure.
- `health`: `auth.test`, reporting the connected bot's identity.
- No `registerWebhook` — Slack has no API to set the Events API Request URL;
  an operator pastes it into the Slack app dashboard by hand.

New: `slackUrlVerificationChallenge()`, the one-time handshake Slack fires
when that URL is saved. Handled at the inbound route
(`apps/web/app/api/agents/[agentId]/channels/[channelId]/route.ts`) and
mirrored in the generated bare-Node server, both *after* the same signature
check `dispatchInbound` would run and *before* calling it — `{ challenge }`
doesn't fit the dispatcher's fixed `{ ok, error?, detail? }` result, and this
isn't a message to dispatch. See
[ADR-014](docs/adrs/adr-014-slack-channel.md) for why this stayed a
route-level special case instead of a change to `ChannelAdapter`, and the
precedent it sets for WhatsApp and Discord.

Also fixes a real bug this work surfaced: a stray backtick inside a plain-JS
comment in `agent-runtime-server.ts` (the generated `server.mjs`'s source,
a giant `String.raw` template literal) silently closed the template early,
breaking every generated bundle — invisible to `tsc` (the literal is just a
string to TypeScript) and to the existing bundle tests (substring checks
only, nothing ever parsed the output). Fixed, and
`e2e/tests/api/agent-runtime-bundle.spec.ts` now has a test that actually
runs `node --check` against the generated `server.mjs`.

No dashboard changes needed — the channel list, settings form, and health
card are all driven by `listChannels()`/`getChannel()`, so Slack appears
automatically once registered.
