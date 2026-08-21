import { loadTool } from './tool-loader';

export interface ToolExtensionContext {
  config: Record<string, unknown>;
  fetch?: typeof globalThis.fetch;
  trackUsage?: (event: {
    meter: string;
    quantity: number;
    unit: string;
    metadata?: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface ToolExtension<TClient = unknown> {
  id: string;
  apiVersion: '1';
  createClient(context: ToolExtensionContext): TClient;
  /** Optionally prepares a declared runtime after the user has installed and selected it. */
  ensureRuntime?(context: ToolExtensionContext): Promise<void>;
}

/** Defines the stable server-side boundary implemented by installable tools. */
export function defineToolExtension<TClient>(
  extension: ToolExtension<TClient>,
): ToolExtension<TClient> {
  return extension;
}

/** Loads and validates an installed tool extension without knowing its domain API. */
export async function loadToolExtension<TClient = unknown>(
  toolId: string,
): Promise<ToolExtension<TClient> | null> {
  const module = await loadTool<Record<string, unknown>>(toolId);
  if (!module) return null;
  const candidate = (module.TOOL_EXTENSION ?? module.default) as Partial<ToolExtension<TClient>>;
  if (
    !candidate ||
    candidate.id !== toolId ||
    candidate.apiVersion !== '1' ||
    typeof candidate.createClient !== 'function'
  ) {
    throw new Error(`Installed tool "${toolId}" does not expose a valid ToolExtension v1.`);
  }
  return candidate as ToolExtension<TClient>;
}
