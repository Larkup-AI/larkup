/**
 * Workspace MCP connection store and AI SDK tool loader.
 *
 * Connections are scoped to the active Larkup server, so Local Chat and all
 * Agents in that workspace can share them. Remote Streamable HTTP and legacy
 * SSE endpoints are supported here. Executing a user-entered local command would
 * require a separate sandbox/approval boundary and is deliberately excluded.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createMCPClient } from '@ai-sdk/mcp';
import {
  getProjectDataDir as getDataDir,
  requireProjectDataDir as requireDataDir,
} from './project-store';

export const MCP_SECRET_REDACTED = '__larkup_secret_set__';
export type McpTransportType = 'http' | 'sse';
/** Route an MCP transport to its server directly or through a configured proxy. */
export type McpConnectionType = 'direct' | 'proxy';

export interface McpConnection {
  id: string;
  name: string;
  /** Remote Streamable HTTP or SSE endpoint. */
  url: string;
  transport: McpTransportType;
  /** Whether the MCP endpoint is contacted directly or through a proxy. */
  connectionType: McpConnectionType;
  /** Proxy endpoint used when connectionType is "proxy". */
  proxyUrl?: string;
  /** Credential sent to the proxy only; never returned from API routes. */
  proxyAuthToken?: string;
  /** Header used to send proxyAuthToken. */
  proxyAuthHeader?: string;
  /** Additional request headers; values are never returned for secret header names. */
  headers: Record<string, string>;
  enabled: boolean;
  /** Makes this connection available to the workspace's Local Chat. */
  enabledForLocalChat: boolean;
  createdAt: string;
  updatedAt: string;
}

export type McpConnectionInput = Partial<
  Pick<
    McpConnection,
    | 'name'
    | 'url'
    | 'transport'
    | 'connectionType'
    | 'proxyUrl'
    | 'proxyAuthToken'
    | 'proxyAuthHeader'
    | 'headers'
    | 'enabled'
    | 'enabledForLocalChat'
  >
>;

export interface LoadedMcpTools {
  tools: Record<string, unknown>;
  /** Must be called after a completed/failed AI SDK run to release transports. */
  close: () => Promise<void>;
  connectedIds: string[];
  failures: { connectionId: string; message: string }[];
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;
const SECRET_HEADER_FRAGMENT = /(token|secret|api[-_]?key|password|credential)/i;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function isSecretHeader(name: string) {
  return SECRET_HEADER.test(name) || SECRET_HEADER_FRAGMENT.test(name);
}

function connectionFile(dir: string) {
  return path.join(dir, 'mcp-connections.json');
}

async function readStoredConnections(): Promise<McpConnection[]> {
  const dir = await getDataDir();
  if (!dir) return [];
  try {
    const parsed = JSON.parse(await fs.readFile(connectionFile(dir), 'utf8')) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isStoredConnection).map((connection) => ({
          ...connection,
          // Existing Streamable HTTP connections pre-date this field.
          transport: connection.transport === 'sse' ? 'sse' : 'http',
          // Existing connections pre-date proxy support and remain direct.
          connectionType: connection.connectionType === 'proxy' ? 'proxy' : 'direct',
          proxyAuthHeader: connection.proxyAuthHeader ?? 'Authorization',
        }))
      : [];
  } catch {
    return [];
  }
}

function isStoredConnection(value: unknown): value is McpConnection {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<McpConnection>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.url === 'string' &&
    (item.transport === undefined || item.transport === 'http' || item.transport === 'sse') &&
    (item.connectionType === undefined ||
      item.connectionType === 'direct' ||
      item.connectionType === 'proxy') &&
    (item.proxyUrl === undefined || typeof item.proxyUrl === 'string') &&
    (item.proxyAuthToken === undefined || typeof item.proxyAuthToken === 'string') &&
    (item.proxyAuthHeader === undefined || typeof item.proxyAuthHeader === 'string') &&
    !!item.headers &&
    typeof item.headers === 'object' &&
    typeof item.enabled === 'boolean' &&
    typeof item.enabledForLocalChat === 'boolean' &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  );
}

async function writeStoredConnections(connections: McpConnection[]) {
  const dir = await requireDataDir();
  await fs.writeFile(connectionFile(dir), JSON.stringify(connections, null, 2), 'utf8');
}

function validateUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('MCP URL is required.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('MCP URL must be a valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('MCP URL must be an HTTP(S) URL without embedded credentials.');
  }
  return url.toString();
}

function validateTransport(value: unknown): McpTransportType {
  if (value === undefined || value === 'http') return 'http';
  if (value === 'sse') return 'sse';
  throw new Error('MCP transport must be Streamable HTTP or SSE.');
}

function validateConnectionType(value: unknown): McpConnectionType {
  if (value === undefined || value === 'direct') return 'direct';
  if (value === 'proxy') return 'proxy';
  throw new Error('MCP connection type must be Direct or Proxy.');
}

function validateHeaderName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEADER_NAME.test(value.trim())) {
    throw new Error(`${label} must be a valid HTTP header name.`);
  }
  return value.trim();
}

function validateProxyFields({
  connectionType,
  proxyUrl,
  proxyAuthHeader,
}: Pick<McpConnection, 'connectionType' | 'proxyUrl' | 'proxyAuthHeader'>) {
  if (connectionType !== 'proxy') return;
  if (proxyUrl === undefined) throw new Error('Proxy URL is required for proxy MCP connections.');
  validateUrl(proxyUrl);
  validateHeaderName(proxyAuthHeader ?? 'Authorization', 'Proxy auth header');
}

function validateProxyToken(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Proxy auth token must be text.');
  if (/[\r\n]/.test(value)) throw new Error('Proxy auth token cannot contain a newline.');
  return value;
}

function validateOptionalUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && !value.trim()) return undefined;
  return validateUrl(value);
}

/** Validate plain HTTP headers before they are persisted or passed to an MCP transport. */
export function validateMcpHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP headers must be an object.');
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (!HEADER_NAME.test(name)) throw new Error(`Invalid MCP header name: ${name}`);
    if (typeof headerValue !== 'string') throw new Error(`MCP header "${name}" must be text.`);
    if (/[\r\n]/.test(headerValue))
      throw new Error(`MCP header "${name}" cannot contain a newline.`);
    headers[name] = headerValue;
  }
  return headers;
}

/** Return an operator-safe projection with authentication header values masked. */
export function redactMcpConnection(connection: McpConnection): McpConnection {
  return {
    ...connection,
    proxyAuthToken: connection.proxyAuthToken ? MCP_SECRET_REDACTED : connection.proxyAuthToken,
    headers: Object.fromEntries(
      Object.entries(connection.headers).map(([name, value]) => [
        name,
        isSecretHeader(name) && value ? MCP_SECRET_REDACTED : value,
      ]),
    ),
  };
}

/** Merge an operator update without overwriting a hidden credential with its sentinel. */
export function mergeMcpConnection(
  current: McpConnection,
  update: McpConnectionInput,
): McpConnection {
  const incomingHeaders =
    update.headers === undefined ? current.headers : validateMcpHeaders(update.headers);
  const headers = Object.fromEntries(
    Object.entries(incomingHeaders).map(([name, value]) => {
      if (value !== MCP_SECRET_REDACTED) return [name, value];
      const previous = Object.entries(current.headers).find(
        ([previousName]) => previousName.toLowerCase() === name.toLowerCase(),
      )?.[1];
      return [name, previous ?? ''];
    }),
  );
  const connectionType =
    update.connectionType === undefined
      ? current.connectionType
      : validateConnectionType(update.connectionType);
  const proxyUrl =
    update.proxyUrl === undefined ? current.proxyUrl : validateOptionalUrl(update.proxyUrl);
  const proxyAuthHeader =
    update.proxyAuthHeader === undefined
      ? current.proxyAuthHeader ?? 'Authorization'
      : validateHeaderName(update.proxyAuthHeader, 'Proxy auth header');
  const incomingProxyAuthToken =
    update.proxyAuthToken === undefined
      ? current.proxyAuthToken
      : validateProxyToken(update.proxyAuthToken);
  const proxyAuthToken =
    incomingProxyAuthToken === MCP_SECRET_REDACTED
      ? current.proxyAuthToken
      : incomingProxyAuthToken;

  validateProxyFields({ connectionType, proxyUrl, proxyAuthHeader });

  return {
    ...current,
    name:
      update.name === undefined
        ? current.name
        : typeof update.name === 'string' && update.name.trim()
        ? update.name.trim().slice(0, 120)
        : (() => {
            throw new Error('MCP name is required.');
          })(),
    url: update.url === undefined ? current.url : validateUrl(update.url),
    transport:
      update.transport === undefined ? current.transport : validateTransport(update.transport),
    connectionType,
    proxyUrl,
    proxyAuthToken,
    proxyAuthHeader,
    headers,
    enabled: update.enabled === undefined ? current.enabled : Boolean(update.enabled),
    enabledForLocalChat:
      update.enabledForLocalChat === undefined
        ? current.enabledForLocalChat
        : Boolean(update.enabledForLocalChat),
    updatedAt: new Date().toISOString(),
  };
}

/** List workspace MCP connections without exposing their secret header values. */
export async function listMcpConnections(): Promise<McpConnection[]> {
  return (await readStoredConnections()).map(redactMcpConnection);
}

/** Server-only access. Never return this value from an API route. */
/** Read one unredacted connection for server-side transport setup. */
export async function readMcpConnection(id: string): Promise<McpConnection | null> {
  return (await readStoredConnections()).find((connection) => connection.id === id) ?? null;
}

/**
 * Server-only export used by the local Agent Runtime launcher. It intentionally
 * returns unredacted transport records because they are passed only to the
 * detached local process, never to a browser response.
 */
export async function readEnabledMcpConnectionsForAgent(): Promise<McpConnection[]> {
  return (await readStoredConnections()).filter((connection) => connection.enabled);
}

/** Persist a new remote MCP connection and return its redacted operator projection. */
export async function createMcpConnection(input: McpConnectionInput): Promise<McpConnection> {
  const now = new Date().toISOString();
  const initial: McpConnection = {
    id: randomUUID(),
    name: '',
    url: '',
    transport: 'http',
    connectionType: 'direct',
    proxyAuthHeader: 'Authorization',
    headers: {},
    enabled: true,
    enabledForLocalChat: false,
    createdAt: now,
    updatedAt: now,
  };
  const connection = mergeMcpConnection(initial, input);
  const connections = await readStoredConnections();
  connections.push(connection);
  await writeStoredConnections(connections);
  return redactMcpConnection(connection);
}

/** Update an existing MCP connection while retaining redacted header values. */
export async function updateMcpConnection(
  id: string,
  input: McpConnectionInput,
): Promise<McpConnection | null> {
  const connections = await readStoredConnections();
  const index = connections.findIndex((connection) => connection.id === id);
  if (index === -1) return null;
  const updated = mergeMcpConnection(connections[index], input);
  connections[index] = updated;
  await writeStoredConnections(connections);
  return redactMcpConnection(updated);
}

/** Remove a workspace MCP connection. Agent selections are harmlessly ignored afterwards. */
export async function deleteMcpConnection(id: string): Promise<boolean> {
  const connections = await readStoredConnections();
  const next = connections.filter((connection) => connection.id !== id);
  if (next.length === connections.length) return false;
  await writeStoredConnections(next);
  return true;
}

function toolPrefix(connection: McpConnection) {
  return `mcp_${connection.id.replace(/-/g, '').slice(0, 10)}_`;
}

function transportForConnection(connection: McpConnection) {
  if (connection.connectionType !== 'proxy') {
    return { type: connection.transport, url: connection.url, headers: connection.headers };
  }

  validateProxyFields(connection);
  const proxyAuthHeader = connection.proxyAuthHeader ?? 'Authorization';
  const headers = connection.proxyAuthToken
    ? {
        ...Object.fromEntries(
          Object.entries(connection.headers).filter(
            ([name]) => name.toLowerCase() !== proxyAuthHeader.toLowerCase(),
          ),
        ),
        [proxyAuthHeader]: connection.proxyAuthToken,
      }
    : connection.headers;
  return { type: connection.transport, url: connection.proxyUrl!, headers };
}

/** Namespace a remote tool record so no MCP tool can replace a built-in tool. */
export function namespaceMcpTools(
  connection: Pick<McpConnection, 'id'>,
  remoteTools: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(remoteTools).map(([name, remoteTool]) => [
      `${toolPrefix(connection as McpConnection)}${name}`,
      remoteTool,
    ]),
  );
}

/** Connect to one remote MCP endpoint and return its namespaced AI SDK tools. */
export async function connectMcpConnection(
  connection: McpConnection,
): Promise<Pick<LoadedMcpTools, 'tools' | 'close'>> {
  const client = await createMCPClient({ transport: transportForConnection(connection) });
  try {
    const remoteTools = await client.tools();
    return { tools: namespaceMcpTools(connection, remoteTools), close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}

/**
 * Discover remote MCP tools and namespace them by connection to prevent a
 * remote tool from replacing a built-in or marketplace tool with the same name.
 */
export async function openMcpTools(
  options: {
    connectionIds?: string[];
    forLocalChat?: boolean;
  } = {},
): Promise<LoadedMcpTools> {
  const wantedIds = options.connectionIds ? new Set(options.connectionIds) : null;
  const selected = (await readStoredConnections()).filter(
    (connection) =>
      connection.enabled &&
      (options.forLocalChat ? connection.enabledForLocalChat : wantedIds?.has(connection.id)),
  );
  const clients: { close: () => Promise<void> }[] = [];
  const tools: Record<string, unknown> = {};
  const connectedIds: string[] = [];
  const failures: LoadedMcpTools['failures'] = [];

  for (const connection of selected) {
    try {
      const loaded = await connectMcpConnection(connection);
      clients.push(loaded);
      Object.assign(tools, loaded.tools);
      connectedIds.push(connection.id);
    } catch (error) {
      failures.push({
        connectionId: connection.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    tools,
    connectedIds,
    failures,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

/** Test a connection without exposing its discovered tools or credentials. */
export async function testMcpConnection(id: string): Promise<{ toolCount: number }> {
  const connection = await readMcpConnection(id);
  if (!connection) throw new Error('MCP connection not found.');
  const client = await createMCPClient({ transport: transportForConnection(connection) });
  try {
    return { toolCount: Object.keys(await client.tools()).length };
  } finally {
    await client.close();
  }
}
