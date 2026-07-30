# Larkup JavaScript SDK

The TypeScript client for a generated Larkup server.

## Install

```bash
npm install @larkup/sdk
```

## Use

```typescript
import { LarkupClient } from '@larkup/sdk';

const client = new LarkupClient({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.LARKUP_API_KEY,
});

const result = await client.query('What is Larkup?', 5);

for await (const event of client.chat('Summarize the result.')) {
  if (event.type === 'text-delta') process.stdout.write(event.text ?? '');
}
```

The client supports health and OpenAPI discovery, retrieval, document CRUD, sequential or parallel bulk indexing with progress, corpus filtering and export, scraping, and streaming chat grounded in retrieved content.

`LarkupHubClient` provides typed Marketplace catalog discovery. Install and uninstall operations remain in the CLI because they change the local Larkup tool directory.

See the [TypeScript SDK documentation](https://www.larkup.de/docs/sdk/typescript) for the complete guide.
