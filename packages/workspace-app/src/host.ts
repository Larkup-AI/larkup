export interface WorkspaceCapabilities {
  sandboxProviders?: string[];
  vectorStores?: string[];
  managedStorage?: boolean;
  durableDocumentSessions?: boolean;
}
let capabilities: WorkspaceCapabilities = {};
export function workspaceCapabilities(): WorkspaceCapabilities {
  return capabilities;
}
/** Configure once in a browser host; resolve the active project per request. */
let hostFetch: typeof globalThis.fetch | undefined;
let resolveApiBase: (() => string) | undefined;
let resolveIntegrationAuthorization: ((integration: string) => string) | undefined;
let resolveStorageScope: (() => string) | undefined;
export function configureWorkspaceHost(options: {
  capabilities?: WorkspaceCapabilities;
  apiBase: () => string;
  storageScope: () => string;
  integrationAuthorizationUrl?: (integration: string) => string;
  fetch?: typeof globalThis.fetch;
}) {
  if (typeof window === 'undefined') return;
  capabilities = options.capabilities ?? {};
  resolveApiBase = options.apiBase;
  hostFetch = options.fetch;
  resolveStorageScope = options.storageScope;
  resolveIntegrationAuthorization = options.integrationAuthorizationUrl;
}
export function workspaceUrl(url: string): string {
  if (!url.startsWith('/api/')) return url;
  const base = resolveApiBase?.();
  if (!base) return url;
  const normalizedBase = base.replace(/\/$/, '');
  // Server-returned media URLs may already be scoped by the browser host.
  // Keep this helper idempotent so shared previews work in both Local and
  // Cloud without either UI knowing the other's route prefix.
  if (url === normalizedBase || url.startsWith(`${normalizedBase}/`)) return url;
  return normalizedBase + url.slice(4);
}

export function workspaceStorageScope(): string {
  return resolveStorageScope?.() ?? '';
}

export function integrationAuthorizationUrl(integration: string): string | undefined {
  return resolveIntegrationAuthorization?.(integration);
}

export const workspaceFetch: typeof globalThis.fetch = (input, init) =>
  (hostFetch ?? globalThis.fetch)(input, init);
export function workspaceStorageKey(key: string): string {
  const scope = workspaceStorageScope();
  return scope ? `${scope}:${key}` : key;
}
