# Larkup JavaScript SDK

The TypeScript client for a generated Larkup server.

## Install

```bash
npm install @larkup/sdk
```

## Use

```typescript
import { LarkupClient } from "@larkup/sdk";

const client = new LarkupClient({
  baseUrl: "http://localhost:8080",
  apiKey: process.env.LARKUP_API_KEY,
});

const result = await client.query("What is Larkup?", 5);

for await (const event of client.chat("Summarize the result.")) {
  if (event.type === "text-delta") process.stdout.write(event.text ?? "");
}
```

The client supports health checks, retrieval, document CRUD, scraping, and streaming retrieval-grounded chat.

See the [TypeScript SDK documentation](https://larkup.de/docs/sdk/typescript) for the complete guide.
