# Knowledge Integration OAuth Proxy — threat model

Scope: `apps/larkup-proxy`. This document exists because plan §10 calls for
one explicitly, and because a proxy that hands out OAuth tokens is exactly
the kind of small, easy-to-overlook service where an unreviewed assumption
becomes an incident. See [ADR-013](../../adrs/adr-013-larkup-proxy-boundary.md)
for the boundary decision this threat model enforces, and
[the deployment guide](./README.md) for setup.

## What this proxy is

A stateless OAuth broker for read-only knowledge-source integrations. It
starts an authorization-code flow on a caller's behalf, exchanges the
resulting code for an access token, and hands that token back to the app
that started the flow. It stores nothing between those two requests except a
signed, short-lived `state` value carried in the URL — no database, no
session store, no cache.

## What this proxy is not

- **Not a channel runtime.** It has no concept of an Agent, a chat session, a
  webhook, or an outbound message. A provider appearing in its registry
  (Slack, for read-only channel history) has no relationship to that same
  provider's channel adapter elsewhere in the codebase (`packages/connections`,
  plan §9) — different OAuth application, different scopes, different trust
  boundary, coincidentally the same company's API.
- **Not a token store.** The access token is handed to the caller's callback
  in a redirect URL query parameter and never written to disk, a database, or
  a log by this service. Where that token lives after the redirect is the
  calling app's responsibility, not this proxy's.
- **Not a credential vault.** Provider client secrets live in this service's
  own environment variables, scoped to this deployment only — plan's
  environment-and-services rule ("never put a secret in the plan, code, or
  logs") applies here like everywhere else in the repo.

## Assets

| Asset | Where it lives | Exposure if compromised |
| --- | --- | --- |
| Provider OAuth client secrets | `apps/larkup-proxy`'s environment only | An attacker could impersonate the Larkup OAuth app to the provider — mint their own authorization requests under Larkup's identity. |
| `OAUTH_STATE_SECRET` | Same | Forge a signed `state` value — see "Threats" below. |
| A user's provider access token, in transit | The redirect URL from this proxy to the calling app's callback, for the seconds between token exchange and the calling app reading it | Whoever can observe that redirect (network position, browser history, a referrer leak) gets read access to the user's provider data for that token's lifetime. |

## Threats and mitigations

**Token handed to an attacker's callback (open redirect).** The entire threat
model of an OAuth proxy collapses if it will redirect a token anywhere the
caller asks. Mitigated by the **redirect-origin policy**:

- `redirect_to` is checked against `LARKUP_ALLOWED_REDIRECT_ORIGINS` — an
  operator-configured allow-list, not the requester's own claim — on *both*
  the request that starts the flow and the callback that completes it
  (`isAllowedCallback`, checked twice: once before redirecting to the
  provider, once before redirecting the token back).
- The check validates the full origin (scheme + host + port) **and** requires
  the path to be exactly `/api/integrations/<id>/callback` — an attacker who
  controls a different path on an otherwise-allowed origin (a same-site XSS
  sink, an open redirect in the *calling* app) cannot redirect the request
  there instead.
- The default allow-list (`http://localhost:4567,http://localhost:3000`)
  only matters for local development; a production deployment sets
  `LARKUP_ALLOWED_REDIRECT_ORIGINS` explicitly and the default never applies
  once it is set.

**CSRF — a forged callback tricking a victim into connecting an attacker's
account.** Mitigated by the signed, single-use-window `state` parameter:
`state` is `base64url(payload).base64url(hmac-sha256(payload))`, verified with
`timingSafeEqual` (not `===`, which would leak comparison timing) and a
10-minute TTL embedded in the signed payload itself (not trusted from the
client). A forged or replayed-after-expiry `state` is rejected before the
code exchange ever happens.

**Token exchange response leaking the client secret into logs.**
Some providers echo request parameters (including the client secret sent in
the request body, for `clientAuthentication: 'body'` providers) in an error
response body. The failure path logs only the provider id and HTTP status,
never the response body — see the comment at the `token_exchange_failed`
branch in `oauth.ts`.

**Denied consent.** A user who declines on the provider's consent screen is
a normal outcome, not an error condition the proxy should surface as one:
the callback checks for the provider's `error` query parameter and redirects
back with `?error=<value>` rather than a 500 or an unhandled exception.

**Missing/misconfigured credentials.** A provider whose `CLIENT_ID`/`CLIENT_SECRET`
env vars are unset fails closed with `503` before ever redirecting to the
provider — never silently proceeds with an empty client id.

**Scope creep via a shared OAuth client.** Atlassian revokes a user's prior
grant when the same OAuth client receives new consent for a narrower scope
set — see the deployment guide's Atlassian notes. Requesting the union of
every product's scopes on every flow (not just the product being connected)
is the mitigation; a narrower per-product request would silently break the
*other* product's existing connection.

## Explicitly out of scope

- **Rate limiting / abuse controls on the proxy itself.** This proxy handles
  low-volume, human-initiated flows (a user clicking "Connect"). Plan §8.5's
  rate limiting is scoped to Agent Runtime endpoints, which face a
  fundamentally different threat (a scripted client spending a model budget).
  Revisit if this proxy is ever exposed to a workflow that scripts OAuth
  starts at volume.
- **Multi-region/HA.** The proxy is stateless and Vercel-deployed; scaling is
  the platform's problem, not this document's.
