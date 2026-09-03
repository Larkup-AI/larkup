# @larkup/connections

## 0.2.0

### Minor Changes

- 738ba6c: feat(agent): channels, execution environments, and the deployable Agent Runtime bundle (TASK 06–08)

  **Channels (TASK 06).** New `@larkup/connections` with the shared dispatch
  pipeline — verify → parse → de-duplicate → run → deliver with retries — plus
  Webhook (HMAC-SHA256, replay window) and Telegram (secret token, message
  splitting, `setWebhook`) adapters. Inbound route, channel management API,
  provider health checks, and a dashboard panel. Channel conversations get a
  bounded server-side session store so a Telegram thread remembers its context.

  **Execution environments (TASK 07).** Every target now carries explicit resource
  limits, a `worker` profile sized for media work, and `admitTool()` returning a
  visible decision instead of silently skipping a tool. Refusals surface in
  `/api/agents/:id/health` with the reason.

  **Agent Runtime bundle (TASK 08).** `GET /api/agents/:id/bundle` generates a
  portable container carrying one immutable release: one Dockerfile for every
  target, Cloud Run and Compose configuration, the widget, and a runbook. Every
  credential is stripped from the image and injected at run time. Structured JSON
  events with correlation ids and credential scrubbing.

  **Fixes**

  - Publishing a release now activates it. Previously a first publish left the
    agent answering "no active release — publish one first".
  - `POST /api/agents` no longer drops `joinCode` and `channels`.
  - The operator agent API no longer returns retrieval keys, join codes, or
    channel tokens in the clear; a redaction sentinel keeps edit round-trips safe.

  See [ADR-010](docs/adrs/adr-010-channels-execution-and-deployment.md).

- Rename the channel adapter package to `@larkup/connections` and remove its type-only dependency cycle with `@larkup/core`.
- 5d9b483: feat(channels): Slack channel adapter (plan §9, third after Webhook and Telegram)

  `packages/connections/src/adapters/slack.ts` — `verify`/`parse`/`send`/`health`
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
  mirrored in the generated bare-Node server, both _after_ the same signature
  check `dispatchInbound` would run and _before_ calling it — `{ challenge }`
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

### Patch Changes

- Complete Telegram setup with automatic webhook registration, add managed
  Discord OAuth and interaction relay support, and make provider webhook
  handshakes extensible through the channel adapter contract.
- Add provider-neutral public webhook ingress metadata and let local Projects create an ngrok HTTPS tunnel for direct channel integrations. Managed Slack OAuth now registers that tunnel with Larkup Proxy automatically.
