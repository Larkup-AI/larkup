# Deploying the Knowledge Integration OAuth Proxy

`apps/larkup-proxy` is a small, independently deployed Hono service with one
job: broker OAuth for the read-only knowledge-source integrations in
`@larkup/integrations` (Notion, the Google workspace apps, Slack channel
history, GitHub, Jira, Linear, Confluence). See
[the threat model](./threat-model.md) for what it is and is not trusted to do,
and [ADR-013](../../adrs/adr-013-larkup-proxy-boundary.md) for why its scope
stays this narrow.

## Deploy

1. **Install dependencies** (from the repo root): `pnpm install`.
2. **Configure environment.** Copy `apps/larkup-proxy/.env.example` to
   `apps/larkup-proxy/.env` and fill in the credentials for the providers you
   are enabling. Two variables are required regardless of which providers you
   enable:

   | Variable | Purpose |
   | --- | --- |
   | `OAUTH_STATE_SECRET` | HMAC key that signs the OAuth `state` parameter. Generate with `openssl rand -hex 32`. Rotating it invalidates every in-flight OAuth attempt (10-minute TTL) — safe, not disruptive to a completed connection. |
   | `LARKUP_ALLOWED_REDIRECT_ORIGINS` | Comma-separated list of origins the proxy is allowed to hand a token back to. Must include the deployed Larkup web app's origin (e.g. `https://larkup.de`), **not** the proxy's own origin. See the threat model's redirect-origin policy. |

   Every other variable is one provider's `<PROVIDER>_CLIENT_ID` /
   `<PROVIDER>_CLIENT_SECRET` pair, only needed for the providers you enable.
3. **Deploy to Vercel** (or any Node-compatible host — the app is a plain
   Hono handler with no Vercel-specific API beyond `hono/vercel`'s adapter):

   ```bash
   cd apps/larkup-proxy
   npx vercel deploy --prod
   ```
4. **Point the web app at this proxy.** In the Larkup web app's environment:

   ```env
   NEXT_PUBLIC_INTEGRATIONS_PROXY_URL="https://<proxy-domain>/api/oauth"
   ```

## Provider registration checklist

Adding a new provider is a registry entry, not a code change to this proxy —
see `packages/integrations/src/catalog.ts`'s `readyIntegrations` array and
`OAuthIntegrationDefinition` in `src/types.ts`.

1. **Add the registry entry.** `id`, `name`, `category`, `description`,
   `icon`, `status: 'ready'`, and an `oauth` block: `authorizationUrl`,
   `tokenUrl`, `scopes` (the narrowest read-only set the provider offers —
   this proxy never requests a write scope), `clientIdEnv` /
   `clientSecretEnv` (the env var names this proxy will read),
   `accessTokenEnv` (the env var name a self-hosted deployment can use to
   skip OAuth entirely with a pre-issued token — see `readers.ts`), and
   `clientAuthentication` (`'basic'` or `'body'`, whichever the provider's
   token endpoint expects).
2. **Add an `IntegrationReader`** in `packages/integrations/src/readers.ts` if
   the integration is meant to actually pull data, not just prove the OAuth
   flow works.
3. **Register the provider's OAuth app** with the provider:
   - Redirect/callback URL: `https://<proxy-domain>/api/oauth/<id>/callback`.
   - Grant only the scopes from step 1 — nothing this proxy doesn't request.
   - If the provider issues one client for multiple product surfaces sharing
     a token (Atlassian's Jira/Confluence is the example already in this
     codebase — re-consenting replaces the *entire* prior grant), request the
     union of every product's scopes on every flow, not just the one being
     connected. See `oauth.ts`'s Jira/Confluence handling for the pattern.
4. **Add `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`** to
   `apps/larkup-proxy/.env.example` (placeholder values, a comment linking to
   the provider's app-registration page) and to the real `.env` on the
   deployed proxy — never anywhere else.
5. **Add the redirect origin**, if this is the first integration for a new
   consuming app, to `LARKUP_ALLOWED_REDIRECT_ORIGINS` on the proxy.
6. **Test the full round trip** against a disposable/test account: start the
   flow, consent, confirm the token lands at the consuming app's callback,
   and confirm a *denied* consent (cancel on the provider's screen) redirects
   back with an `error` query param instead of hanging or erroring server-side.
   `e2e/tests/api/larkup-proxy.spec.ts` has the contract-level version of this
   for the state/redirect-validation half; the live-provider round trip still
   needs a human with real credentials once.

### Provider-specific notes

**Google.** `Error 403: access_denied` during testing means the OAuth
consent screen is still in **Testing** mode and the signing-in account is not
on the approved tester list — add it under Google Auth Platform → Audience →
Test users. For public access, publish the app and submit it for
verification with only the scopes the enabled integrations need (Drive
read-only is a restricted scope and needs Google's approval). Add one
callback per enabled Google integration (e.g. `/api/oauth/google-calendar/callback`)
to the same OAuth client.

**Atlassian (Jira, Confluence).** Both share one OAuth client and always
request the union scope set (`read:jira-work`, `read:page:confluence`,
`offline_access`) — see step 3 above. Register both callback paths under
**Authorization**. After changing scopes, existing connections must
disconnect and reconnect to receive the new grant.

**Linear.** One OAuth application, `read` scope only, callback
`/api/oauth/linear/callback`.

## Operations

- **Health check:** `GET /api/health` → `{ "status": "ok", "service": "larkup-proxy" }`.
- **Rotating `OAUTH_STATE_SECRET`:** safe at any time. It only invalidates
  OAuth attempts started in the last 10 minutes that have not yet completed
  their callback — a user mid-flow gets "Invalid or expired OAuth state" and
  simply retries.
- **Logs:** the proxy logs nothing about the token itself — see the threat
  model's "what this proxy never does" section. A failed token exchange logs
  the provider and status code, not the response body.
