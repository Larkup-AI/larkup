# ADR-013: `larkup-proxy` Stays a Knowledge Integration OAuth Proxy

**Status:** Accepted
**Date:** 2026-08-12
**Decision makers:** Product owner, maintainers
**Closes:** plan §10.

## Context

`apps/larkup-proxy` brokers OAuth for the read-only knowledge-source
integrations in `@larkup/integrations` (Notion, the Google workspace apps,
Slack channel history, GitHub, Jira, Linear, Confluence). Plan §2 named it as
useful shared infrastructure with a boundary worth making explicit before it
accumulates scope it was never designed for: "It must not become a general
proxy for Agent channels or tool execution." §10 asked for that boundary to
actually be documented, not just asserted, plus the operational artifacts
(deployment guide, threat model, redirect-origin policy, provider checklist)
a service handling OAuth tokens should have and did not yet.

## Decision

### 1. Keep it, narrow it in writing, do not rename the package

The proxy is genuinely useful, general-purpose OAuth-broker infrastructure —
signed/expiring state, redirect-origin validation, a registry-driven provider
list. It stays in the monorepo as `apps/larkup-proxy` / `@larkup/proxy`.

What changed is what it is _documented_ as: every entry point now opens with
"Knowledge Integration OAuth Proxy" and a one-line statement of what it
never becomes (`api/index.ts`, `api/routes/oauth.ts`, `README.md`). The
package name and directory are unchanged — a rename would touch the deployed
Vercel project, `NEXT_PUBLIC_INTEGRATIONS_PROXY_URL` on every consumer, and
every provider's registered callback URL, for a purely cosmetic gain. The
same "don't blind-rename a working, referenced identity" reasoning plan's
Marketplace naming decision already applies to `apps/marketplace` here.

### 2. The Slack-in-two-places ambiguity is named, not hidden

`@larkup/integrations`'s Slack entry (public channel history, an OAuth
user-token app) and the Slack _channel_ adapter (plan §9,
`packages/connections`, a bot-token app that sends and receives chat
messages) are unrelated integrations that happen to share a provider name.
Nothing enforces this at the type level — a future contributor could plausibly
wire channel-adapter code through this proxy because "Slack already has an
entry here." The threat model and README now say explicitly why that would
be wrong: different OAuth application, different scopes, different trust
boundary. This is the concrete version of §2's abstract "must not become a
general proxy for Agent channels" warning — the collision that was likely to
actually happen, named so it does not.

### 3. Fully registry-driven — the local override was dead weight, not defense in depth

`api/routes/oauth.ts` carried a `proxyOAuthOverrides` object duplicating
Jira/Confluence/Linear's OAuth config, which already lived in
`@larkup/integrations`'s registry with identical values. The comment above it
explained the original reason — guarding against the proxy consuming a stale,
separately-published version of the registry package — but `apps/larkup-proxy`
depends on `@larkup/integrations` via `workspace:*`, so within this monorepo
that version-skew scenario cannot occur: a workspace dependency always
resolves to the current package. Removed. Every provider, including these
three, now resolves purely through `getIntegration()`. If `@larkup/integrations`
is ever published and consumed outside this workspace by a differently-versioned
proxy build, that is a new problem needing its own solution — not a reason to
carry silently-drifting duplicate data today.

### 4. Threat model and redirect-origin policy as one document, not four

Plan §10 names four artifacts: a deployment guide, a threat model, a
redirect-origin policy, and a provider registration checklist. Built as two
files rather than four: `docs/deploy/larkup-proxy/README.md` (deployment
guide, ending in the provider registration checklist — registering a
provider is a deployment/configuration activity, not a separate concern) and
`docs/deploy/larkup-proxy/threat-model.md` (threat model, with the
redirect-origin policy as its first and most important mitigation — it is
the answer to the threat model's own central question, "what stops this
proxy from handing a token to an attacker's callback"). Four files would have
fragmented content that reads better together; two files with clear headers
keep every artifact plan §10 asked for independently discoverable.

### 5. Contract tests, not a live-provider test

`api/routes/oauth.test.ts` (14 cases) covers the properties enforceable
without real provider credentials: redirect-origin validation (allowed
origin, disallowed origin, allowed origin wrong path), signed-state
correctness (tampered signature, expired TTL, integration/state mismatch),
denied consent, a successful token exchange, and a failed one — including
that a failed exchange's response body (which can echo a client secret) never
reaches the browser. What it does not and cannot cover: an actual round trip
against a live provider's OAuth server, which needs real credentials and a
human consenting once. The deployment guide's provider registration checklist
says so explicitly rather than implying full automated coverage exists.

## Amendment — 2026-08-16: managed channel setup is a distinct proxy surface

The product now distributes Larkup as a local application, so requiring every
installation to hold a Slack OAuth client secret is not acceptable. The proxy
therefore exposes `/api/channels` alongside — not inside — the existing
registry-backed `/api/oauth` routes. Its Slack route is limited to the OAuth
code exchange and validation of Slack's signed request bytes. It does not
store a workspace token, accept a conversation, route an event, or call an
Agent. Those responsibilities remain with `apps/web` and
`packages/connections`.

This preserves the meaningful part of the original separation: knowledge
OAuth and channel OAuth cannot share scopes, callbacks, or route policies.

## Consequences

**Positive**

- The boundary plan §2 asked for exists as text a future contributor will
  actually read, at the exact point (`oauth.ts`'s Slack handling) where the
  ambiguity it is protecting against would first come up.
- One fewer place provider OAuth config can silently drift from the registry.
- A change to `isAllowedCallback`, `signState`, or `verifyState` — the
  functions the threat model's mitigations depend on — now has tests that
  fail if it breaks one of those properties.

**Negative**

- The provider registration checklist's live-round-trip step still needs a
  human with real credentials; nothing here automates that.
- No rate limiting on this proxy (explicitly out of scope — see the threat
  model's final section). Acceptable while its traffic is human-initiated
  OAuth starts; revisit if that assumption ever stops holding.
