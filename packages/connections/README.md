# @larkup/connections

Provider adapters and the shared inbound message dispatcher for Webhook, Telegram, Slack, and Discord connections.

Adapters validate requests, normalize messages, deliver replies, and expose setup metadata. Keep provider-specific behavior in `src/adapters`; the dashboard and API routes consume the generic contract.

```bash
pnpm --filter @larkup/connections test
pnpm --filter @larkup/connections type-check
```
