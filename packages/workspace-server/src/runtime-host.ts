import { AsyncLocalStorage } from 'node:async_hooks';
import { SandboxManager } from '@larkup/sandbox';
import type { SandboxConfig } from '@larkup/sandbox/types';
export interface WorkspaceRuntimeHost {
  readBinary?: (source: { id: string; url?: string }) => Promise<Uint8Array>;
  apiUrl?: (path: string) => string;
  fetch?: typeof globalThis.fetch;
  sandbox: Pick<SandboxManager, 'execute' | 'healthCheck'>;
}
const runtime = new AsyncLocalStorage<WorkspaceRuntimeHost>();
export function runWithWorkspaceRuntime<T>(host: WorkspaceRuntimeHost, operation: () => T): T {
  return runtime.run(host, operation);
}
export function workspaceSandbox(
  config: SandboxConfig,
): Pick<SandboxManager, 'execute' | 'healthCheck'> {
  return runtime.getStore()?.sandbox ?? new SandboxManager(config);
}

export function workspaceServerUrl(path: string): string {
  return runtime.getStore()?.apiUrl?.(path) ?? path;
}
export const workspaceServerFetch: typeof globalThis.fetch = (input, init) =>
  (runtime.getStore()?.fetch ?? globalThis.fetch)(input, init);

export function workspaceReadBinary(source: {
  id: string;
  url?: string;
}): Promise<Uint8Array> | undefined {
  return runtime.getStore()?.readBinary?.(source);
}
