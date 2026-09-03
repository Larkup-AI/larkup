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

## Agent Server

In **Settings → Runtime**, select **Agent** and start the server. Then use its
displayed URL:

```typescript
import { LarkupAgentClient } from '@larkup/sdk';

const agent = new LarkupAgentClient({
  baseUrl: 'http://localhost:8080',
  apiKey: process.env.LARKUP_API_KEY,
});
for (const capability of await agent.capabilities()) {
  console.log(capability.name, capability.tools);
}
console.log((await agent.configuration()).systemPrompt);
console.log(await agent.sandbox());
for await (const text of agent.streamText('Hello')) {
  process.stdout.write(text);
}
```

`agent.capabilities()` groups selected built-ins, skills, sandbox, MCP connections, and plugins. Entries marked `configured` are selected but not executable by this runtime; `active` entries are loaded. Use `tools()` for the raw tool list, `configuration()` for saved customization, and `sandbox()` for sanitized execution-environment readiness. `agent.streamText()` yields plain text chunks as they arrive, `agent.chat()` exposes the raw AI SDK UI-message stream, and `chatText()` collects it into a string.

### React widget

`@larkup/sdk/react` loads the generated widget served by an Agent Server:

```tsx
import { AgentWidget } from '@larkup/sdk/react';

export function SupportChat() {
  return <AgentWidget serverUrl="https://agent.example.com" theme="dark" />;
}
```

Pass `apiKey` only when the deployment requires it. The component supports the
same title, message, color, logo, and position options as the script embed.

### Select an available chat model

Generated runtimes expose their usable chat catalog through the SDK. Model
selection is per request, so it does not mutate the deployment default.

```ts
const catalog = await agent.chatModelCatalog();
const model = (await agent.chatModels('anthropic')).at(0);

if (model) {
  console.log(await agent.chatText({
    messages: [{ role: 'user', content: 'Summarize the project.' }],
    provider: catalog.configuredProvider,
    modelId: model.id,
  }));
}
```

AI Gateway runtimes can select any language model returned by the catalog;
direct-provider runtimes are limited to their configured provider. See the
[Vercel AI Gateway model catalog](https://vercel.com/ai-gateway/models) for current providers and models.

`LarkupHubClient` provides typed Marketplace catalog discovery. Install and uninstall operations remain in the CLI because they change the local Larkup tool directory.

See the [TypeScript SDK documentation](https://www.larkup.de/docs/sdk/typescript) for the complete guide.

## Development

```bash
pnpm --filter @larkup/sdk test
pnpm --filter @larkup/sdk type-check
pnpm --filter @larkup/sdk build
```
