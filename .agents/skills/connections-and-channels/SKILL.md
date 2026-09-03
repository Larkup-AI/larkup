---
name: connections-and-channels
description: Add, modify, or troubleshoot Larkup Agent message connections and provider channels (Slack, Telegram, Discord, webhooks, and future providers). Use when changing the Connections settings UI, `@larkup/connections`, managed channel OAuth, inbound webhooks, provider credentials, or local-production channel setup.
---

# Connections and Channels

Keep the connection catalog, UI, secure credential boundary, and inbound
delivery contract aligned. Read `packages/connections/src/types.ts`, the
relevant adapter, `apps/web/app/api/connections`, and the matching proxy route
before changing behavior.

## Boundaries

- Put executable provider behavior, configuration fields, UI copy, setup
  instructions, and test hints in `@larkup/connections`. Do not hardcode a
  provider in `connections-tab.tsx`; use adapter metadata and generic fallbacks.
- Keep read-only knowledge integrations under `/api/oauth` separate from Agent
  channels under `/api/channels`. Use separate provider OAuth apps and scopes.
- Store shared managed-channel secrets only in `apps/larkup-proxy` deployment
  configuration. Use `CONNECTION_<PROVIDER>_<CREDENTIAL>` names, for example
  `CONNECTION_SLACK_CLIENT_ID`. Never add them to `apps/web`, project records,
  generated Agent servers, browser code, fixtures, or logs.
- Use `managedChannelsProxyUrl()` for managed proxy requests. Larkup's hosted
  proxy is the source default; expose `NEXT_PUBLIC_CHANNELS_PROXY_URL` only as
  an optional self-hosted override, never as required local setup.
- Treat local Larkup as a production target. It is not, however, publicly
  reachable at `localhost`: inbound providers need stable public HTTPS ingress.
  A shared provider app with one webhook URL cannot route directly to multiple
  independent local machines without an authenticated relay.

## Add or change a channel

1. Add or update the adapter in `packages/connections/src/adapters/`; register
   it in `registry.ts`. Supply `configFields`, `setupInstructions`, `testHint`,
   and `connectionUi` / `oauthConnect` metadata as appropriate.
2. Preserve redaction: API reads return masked settings; blank values retain an
   existing saved secret. Verify incoming signatures before parsing or invoking
   the Agent.
3. For direct credentials, use the local connection route. For managed OAuth,
   add a narrowly scoped `/api/channels/<provider>` proxy route with signed,
   expiring state; allow only the exact local callback path and configured
   origins.
4. Add every required placeholder and callback URL to
   `apps/larkup-proxy/.env.example`; update
   `docs/deploy/larkup-proxy/README.md` with provider setup, scopes, event
   subscriptions, reinstall requirements, and local ingress requirements.
5. Keep the connection sheet simple: select Agent, connect with OAuth or own
   credentials, save, show the webhook URL and exact test action. A connection
   status belongs only to its matching provider id.

## Extensibility rules

- The app route must never branch on a provider id. Put protocol-specific
  webhook handshakes, pings, and acknowledgements on the adapter through
  `interceptInbound()`.
- Put every provider-owned label, credential hint, setup step, public-ingress
  explanation, contact instruction, and external test URL in adapter metadata.
  `connections-tab.tsx` renders that metadata generically.
- Use `registerWebhook()` only when the provider API can set the URL itself.
  Register before persisting the connection so a failed provider setup never
  leaves a misleading "connected" local record.
- Model a managed connection only when the provider supports a shared,
  platform-owned install flow. Static bot tokens (Telegram, Discord) remain
  project-local credentials; do not send them to the proxy or add a database
  dependency merely to support them.
- Every new adapter needs unit coverage for request verification, parsing,
  sending, health, and webhook registration or interception where applicable.
  Add one dashboard E2E assertion proving its metadata renders without a
  channel-specific component.

## Slack managed connection checklist

- Register `https://<proxy-domain>/api/channels/slack/oauth/callback`.
- Configure `CONNECTION_SLACK_CLIENT_ID`,
  `CONNECTION_SLACK_CLIENT_SECRET`, and `CONNECTION_SLACK_SIGNING_SECRET` in
  the deployed proxy; configure `OAUTH_STATE_SECRET` and allowed app origins
  too.
- Request only the bot scopes in `api/routes/channels.ts`; enable the matching
  Event Subscriptions and reinstall after scope changes.
- Verify OAuth start, denied consent, successful exchange, valid and invalid
  signatures, and the public HTTPS webhook path. Never claim a shared Slack app
  can receive events for many local instances until a relay is implemented.

## Validate

Run the narrow proxy suite and typecheck:

```bash
pnpm --filter @larkup/proxy test
pnpm --filter @larkup/proxy type-check
pnpm --filter @larkup/connections type-check
pnpm --filter larkup exec tsc --noEmit
```

Add or update E2E coverage under `e2e/tests/web-ui/` for user-visible
connection changes. Do not deploy, rotate credentials, or delete connection
data unless the user explicitly asks.
