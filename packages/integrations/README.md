# `@larkup/integrations`

The shared, read-only integration contract for Larkup apps. It keeps the public catalog, OAuth configuration, credential names, and fetchers in one place.

## Supported sources

- Notion pages
- Google Drive files, Docs, and Sheets
- Slack channel history
- GitHub repository READMEs
- Confluence pages

## Use in an app

```ts
import { getIntegration, getIntegrationReader, integrations } from '@larkup/integrations';

const definition = getIntegration('google-drive');
const reader = getIntegrationReader('google-drive');
const resources = await reader?.listResources(accessToken);
```

Apps use `integrations` for UI metadata, the proxy uses `definition.oauth` to run OAuth, and server code uses the reader to list and import content. All readers are deliberately fetch-only: this package contains no mutation or CRUD methods.

## Add a provider

1. Add one `IntegrationDefinition` to `src/catalog.ts`, including its unique token environment variable and least-privileged scopes.
2. Add its `IntegrationReader` to `src/readers.ts`, implementing `listResources` and `getResource`.
3. Add catalog and reader tests. The proxy and generic app routes will recognize the new ID automatically.

Never put client secrets or access tokens in this package. The OAuth client credentials belong in `apps/larkup-proxy/.env`; consuming apps own the resulting token storage.
