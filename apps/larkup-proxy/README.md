# Larkup Proxy

This is the centralized OAuth proxy for Larkup. It securely handles OAuth for the read-only knowledge sources in `@larkup/integrations`: Notion, Google Analytics, Calendar, Docs, Drive, My Maps, Meet, Sheets, Slides, Slack, GitHub, and Confluence.

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

   `OAUTH_STATE_SECRET` and `LARKUP_ALLOWED_REDIRECT_ORIGINS` are required. The latter must include the deployed Larkup web app origin; it prevents the proxy from returning a user token to an untrusted callback.

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
