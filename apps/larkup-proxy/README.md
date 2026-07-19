# Larkup Proxy

This is the centralized OAuth proxy for Larkup. It securely handles the OAuth flows (like Notion) so your open-source users don't have to create their own integrations.

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
   *For Notion, create a Public Integration in the Notion Developer Portal and get the Client ID and Secret.*

3. **Deploy to Vercel:**
   Run the Vercel CLI to deploy this project:
   ```bash
   npx vercel deploy --prod
   ```

## Extending Integrations

To add a new integration (e.g., Slack, GitHub):
1. Create a new route file in `api/routes/` (e.g., `slack.ts`).
2. Add your authorization and callback logic similar to `notion.ts`.
3. Register the route in `api/index.ts`.

## Usage in Larkup

Once deployed, set the `NEXT_PUBLIC_NOTION_AUTHORIZATION_URL` in your main Larkup app's `.env.local` to point to this proxy:

```env
NEXT_PUBLIC_NOTION_AUTHORIZATION_URL="https://your-proxy-domain.vercel.app/api/oauth/notion"
```
