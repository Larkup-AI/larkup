# Larkup Proxy — Knowledge Integration OAuth Proxy

This is the centralized OAuth proxy for Larkup (plan §10; see
[ADR-013](../../docs/adrs/adr-013-larkup-proxy-boundary.md) for the boundary
decision). It securely handles OAuth for the read-only knowledge sources in
`@larkup/integrations`: Notion, Google Analytics, Calendar, Docs, Drive, My
Maps, Meet, Sheets, Slides, Slack, GitHub, Jira, Linear, and Confluence.

**Three isolated surfaces.** `/api/oauth` answers one question — "exchange
this OAuth code for a read-only knowledge-source token" — for a registry
integration. `/api/channels` is separately scoped to managed channel setup: it
exchanges managed Slack and Discord OAuth grants, verifies provider request
signatures, and relays a verified event to the installing Larkup app. The relay stores a
workspace id, public tunnel URL, and a hash of a local relay secret — never a
bot token, Agent API key, or chat response. Slack therefore has two
intentionally separate flows: read-only history under `/api/oauth/slack`, and
a bot installation under `/api/channels/slack/oauth`. See
[the deployment guide](../../docs/deploy/larkup-proxy/README.md) and
[the threat model](../../docs/deploy/larkup-proxy/threat-model.md) for the
full boundary and redirect-origin policy.

## Setup & Deployment

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env` and fill in your integration credentials.

   ```bash
   cp .env.example .env
   ```

   The example file links to every provider's app-registration page. Set each provider callback URL to `https://<proxy-domain>/api/oauth/<integration>/callback`. For Google, add a callback for every Google integration you enable (for example, `/api/oauth/google-calendar/callback`) to the same OAuth client.

   `OAUTH_STATE_SECRET` and `LARKUP_ALLOWED_REDIRECT_ORIGINS` are required. The latter must include the deployed Larkup web app origin (for example, `https://larkup.de`), not the proxy origin; it prevents the proxy from returning a user token to an untrusted callback.

### Managed Slack channels

Use a separate Slack app for managed Agent channels. Set
`CONNECTION_SLACK_CLIENT_ID`, `CONNECTION_SLACK_CLIENT_SECRET`, and
`CONNECTION_SLACK_SIGNING_SECRET` in this proxy only. The `SLACK_*` variables
remain for the read-only knowledge integration.

Register `https://<proxy-domain>/api/channels/slack/oauth/callback` as the
managed app's OAuth redirect URL. Request only the bot scopes listed in
`.env.example`; configure the `app_mention` and `message.im` events. Set the
Events API Request URL once to `https://<proxy-domain>/api/channels/slack/events`,
save, and reinstall the app. No end user ever puts these shared app secrets in
a local Larkup environment or project record.

Larkup web apps use `https://larkup-proxy.larkup.de/api/channels` by default;
they need no managed-channel setting or Slack secret. Set
`NEXT_PUBLIC_CHANNELS_PROXY_URL` only when operating a self-hosted managed
channel proxy.

Local Larkup is a supported production target, but `localhost` is not public.
Larkup starts a secure HTTPS tunnel locally, then registers it after managed
OAuth. The shared Events API URL above stays fixed; the relay routes each
verified workspace event to the installation that authorized it. Set
`DATABASE_URL` on the proxy to a pooled Postgres connection before enabling
managed Slack. The proxy creates its small relay table on first use.

### Managed Discord channels

Set `CONNECTION_DISCORD_CLIENT_ID`, `CONNECTION_DISCORD_CLIENT_SECRET`,
`CONNECTION_DISCORD_PUBLIC_KEY`, and `CONNECTION_DISCORD_BOT_TOKEN` in this
proxy only. In Discord's Developer Portal set the OAuth callback to
`https://<proxy-domain>/api/channels/discord/oauth/callback`, the Interactions
Endpoint URL to `https://<proxy-domain>/api/channels/discord/interactions`, and
enable **Bot Require Code Grant**. Users then choose a server from Larkup; the
proxy creates `/ask` there and routes verified interactions to that user's
registered tunnel. No Discord bot token is copied into the local project.

### Google OAuth testing and release

The Google error shown as `Error 403: access_denied` means the OAuth consent screen is still in **Testing** and the signing-in Google account is not on its approved tester list. In Google Cloud Console, open **Google Auth Platform → Audience**, keep the app External, and add each testing account under **Test users**. This unblocks testing immediately.

For public customer access, publish the OAuth app and submit it for verification with only the scopes your enabled integrations need. Google Drive read-only is a restricted scope, so public use requires Google's approval. Test-user grants expire after seven days while the app stays in Testing.

### Atlassian Jira and Confluence access

Under **Authorization**, add both `/api/oauth/confluence/callback` and `/api/oauth/jira/callback`. The host must be the deployed proxy host (for example, `https://larkup-proxy.larkup.de`), and `NEXT_PUBLIC_INTEGRATIONS_PROXY_URL` in the web app must use that same host followed by `/api/oauth`.

Under **Permissions**, add the Confluence and Jira APIs and enable `read:jira-work`, `read:page:confluence`, and `offline_access`. Both integrations use the same Atlassian OAuth client and deliberately request this shared least-privilege scope set every time. Atlassian replaces a user's previous grant when they consent again, so requesting only one product’s scope would make the other product fail with `Unauthorized; scope does not match`.

After deploying this change, disconnect any old Jira or Confluence connection and reconnect it to receive the shared scope grant. If the Jira authorization page itself says **Access denied**, the signing-in account does not have Jira product access on the selected Cloud site; create a Jira Cloud site or ask that site's organization admin to grant product access, then reconnect.

### Linear

Create a Linear OAuth application, add `/api/oauth/linear/callback` as its redirect URL, and grant only the `read` scope. Set `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` in the proxy; users connect with OAuth and Larkup saves the returned access token.

3. **Deploy to Vercel:**
   Run the Vercel CLI to deploy this project:
   ```bash
   npx vercel deploy --prod
   ```

## Extending integrations

Add one registry entry and a read-only `IntegrationReader` to `packages/integrations`. The proxy automatically exposes its OAuth route, and apps can reuse the catalog and reader without duplicating provider IDs, scopes, or environment-variable names.

## Usage in Larkup

Once deployed, set the `NEXT_PUBLIC_NOTION_AUTHORIZATION_URL` in your main Larkup app's `.env.local` to point to this proxy:

```env
NEXT_PUBLIC_INTEGRATIONS_PROXY_URL="https://your-proxy-domain.vercel.app/api/oauth"
```
