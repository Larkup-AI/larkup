---
'@larkup/proxy': patch
---

docs(larkup-proxy): document the Knowledge Integration OAuth Proxy boundary (plan §10)

No behavior change for a correctly-configured deployment — this closes
plan §10's documentation and hygiene gap.

- Removed `oauth.ts`'s `proxyOAuthOverrides` object: Jira, Confluence, and
  Linear's OAuth config duplicated what `@larkup/integrations`'s registry
  already had, byte-for-byte. Every provider now resolves purely through
  the registry (`getIntegration()`) — one fewer place config can drift.
- Documented the boundary explicitly at every entry point
  (`api/index.ts`, `api/routes/oauth.ts`, `README.md`): this proxy is OAuth
  for read-only knowledge sources only, never a channel runtime — including
  naming the specific ambiguity a future contributor could plausibly hit
  (the registry's Slack entry, for read-only channel history, is unrelated
  to the Slack *channel* adapter in `packages/channels-core`).
- New: `docs/deploy/larkup-proxy/README.md` (deployment guide + provider
  registration checklist) and `docs/deploy/larkup-proxy/threat-model.md`
  (threat model + redirect-origin policy). See
  [ADR-013](docs/adrs/adr-013-larkup-proxy-boundary.md).
- New: `api/routes/oauth.test.ts` — 14 contract tests covering
  redirect-origin validation, signed/expiring OAuth state, denied consent,
  and that a failed token exchange never leaks the provider's raw response
  (which can echo a client secret) back to the browser.
- A failed token exchange now logs the provider and HTTP status (never the
  response body) instead of nothing, matching the threat model's "what gets
  logged" claim.
