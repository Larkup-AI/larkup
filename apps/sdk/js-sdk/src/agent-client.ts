import type {
  AgentChatRequest,
  AgentCapability,
  AgentChatMessage,
  AgentHealth,
  AgentInfo,
  AgentOpenApiDocument,
  AgentRuntimeConfiguration,
  AgentSandboxStatus,
  AgentTool,
  ChatModel,
  ChatModelCatalog,
  ChatProvider,
  LarkupAgentClientOptions,
  LarkupAgentToolInput,
} from './types';
import { LarkupApiError } from './client';

function headers(options: LarkupAgentClientOptions): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    ...(options.joinCode ? { 'X-Larkup-Join-Code': options.joinCode } : {}),
  };
}

/** Extract a text delta from one AI SDK data-stream or UI-message stream line. */
function textFromStreamLine(line: string): string | undefined {
  try {
    if (line.startsWith('0:')) {
      const value = JSON.parse(line.slice(2)) as unknown;
      return typeof value === 'string' ? value : undefined;
    }
    if (!line.startsWith('data:')) return undefined;

    const event = JSON.parse(line.slice('data:'.length).trim()) as {
      type?: string;
      delta?: unknown;
      text?: unknown;
    };
    if (event.type !== 'text-delta') return undefined;
    return typeof event.delta === 'string'
      ? event.delta
      : typeof event.text === 'string'
      ? event.text
      : undefined;
  } catch {
    // Ignore non-text frames and malformed legacy frames.
    return undefined;
  }
}

function groupAgentTools(tools: AgentTool[]): AgentCapability[] {
  const groups = new Map<string, AgentCapability>();
  for (const tool of tools) {
    const source = tool.source ?? 'built-in';
    const id = source === 'mcp'
      ? `mcp:${tool.connectionId ?? 'remote'}`
      : source === 'plugin'
        ? `plugin:${tool.pluginId ?? 'plugin'}`
        : source;
    const name = source === 'mcp'
      ? `MCP · ${tool.connectionId ?? 'Remote server'}`
      : source === 'plugin'
        ? `Plugin · ${tool.pluginId ?? 'Plugin'}`
        : source === 'sandbox'
          ? 'Sandbox'
          : 'Built-in tools';
    const group = groups.get(id) ?? { id, name, source, connectionId: tool.connectionId, pluginId: tool.pluginId, tools: [] };
    group.tools.push(tool);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** Client for one generated Larkup Agent Server. */
export class LarkupAgentClient {
  private readonly baseUrl: string;

  constructor(private readonly options: LarkupAgentClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ||
      process.env.LARKUP_AGENT_URL ||
      'http://localhost:8081'
    ).replace(/\/$/, '');
  }

  async info(): Promise<AgentInfo> {
    const response = await fetch(`${this.baseUrl}/agent`, { headers: headers(this.options) });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response.json() as Promise<AgentInfo>;
  }

  /** Check whether the local or deployed Agent Server is reachable. */
  async health(): Promise<AgentHealth> {
    const response = await fetch(`${this.baseUrl}/health`, { headers: headers(this.options) });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response.json() as Promise<AgentHealth>;
  }

  /** Read the runtime's OpenAPI document, also available in Scalar at /reference. */
  async openApi(): Promise<AgentOpenApiDocument> {
    const response = await fetch(`${this.baseUrl}/openapi.json`, {
      headers: headers(this.options),
    });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response.json() as Promise<AgentOpenApiDocument>;
  }

  /** List every tool currently loaded by this Agent Server, including MCP and plugins. */
  async tools(): Promise<AgentTool[]> {
    const response = await fetch(`${this.baseUrl}/agent/tools`, { headers: headers(this.options) });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    const body = (await response.json()) as { tools?: AgentTool[] };
    return body.tools ?? [];
  }

  /** List integrations as grouped capabilities, including one group per MCP connection. */
  async capabilities(): Promise<AgentCapability[]> {
    const response = await fetch(`${this.baseUrl}/agent/capabilities`, { headers: headers(this.options) });
    if (response.status === 404) return groupAgentTools(await this.tools());
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    const body = (await response.json()) as { capabilities?: AgentCapability[] };
    return body.capabilities ?? [];
  }

  /** Read the Agent prompt and enabled skill metadata saved for this runtime. */
  async configuration(): Promise<AgentRuntimeConfiguration> {
    const response = await fetch(`${this.baseUrl}/agent/configuration`, { headers: headers(this.options) });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response.json() as Promise<AgentRuntimeConfiguration>;
  }

  /** Check the Agent's configured code-execution environment without exposing credentials. */
  async sandbox(): Promise<AgentSandboxStatus> {
    const response = await fetch(`${this.baseUrl}/agent/sandbox`, { headers: headers(this.options) });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response.json() as Promise<AgentSandboxStatus>;
  }

  /** List all chat providers and models available to this Agent Runtime. */
  async chatModelCatalog(provider?: string): Promise<ChatModelCatalog> {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    const response = await fetch(`${this.baseUrl}/models${query}`, { headers: headers(this.options) });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response.json() as Promise<ChatModelCatalog>;
  }

  /** List chat model vendors available to this Agent Runtime. */
  async chatProviders(): Promise<ChatProvider[]> {
    return (await this.chatModelCatalog()).providers;
  }

  /** List chat models, optionally filtered by their vendor. */
  async chatModels(provider?: string): Promise<ChatModel[]> {
    return (await this.chatModelCatalog(provider)).models;
  }

  private chatPayload(message: string | AgentChatMessage[] | AgentChatRequest): AgentChatRequest {
    if (typeof message === 'string') return { messages: [{ role: 'user', content: message }] };
    if (Array.isArray(message)) return { messages: message };
    return message;
  }

  /** Returns the raw AI SDK data-stream response for callers that stream themselves. */
  async chat(message: string | AgentChatMessage[] | AgentChatRequest): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: headers(this.options),
      body: JSON.stringify(this.chatPayload(message)),
    });
    if (!response.ok) throw new LarkupApiError(response.status, await response.text());
    return response;
  }

  /** Stream plain assistant text as it arrives from the Agent Server. */
  async *streamText(message: string | AgentChatMessage[] | AgentChatRequest): AsyncGenerator<string> {
    const response = await this.chat(message);
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const text = textFromStreamLine(line);
        if (text !== undefined) yield text;
      }

      if (done) break;
    }

    const text = textFromStreamLine(buffer);
    if (text !== undefined) yield text;
  }

  /** Collect the Agent Server's AI SDK data stream into plain text. */
  async chatText(message: string | AgentChatMessage[] | AgentChatRequest): Promise<string> {
    const response = await this.chat(message);
    const body = await response.text();
    let answer = '';
    for (const line of body.split(/\r?\n/)) {
      const text = textFromStreamLine(line);
      if (text !== undefined) answer += text;
    }
    return answer;
  }

  /** Returns an executor compatible with AI SDK tools. */
  asAiSdkToolExecutor(): (input: LarkupAgentToolInput) => Promise<string> {
    return async ({ message }) => this.chatText(message);
  }
}

/** Creates an AI SDK-compatible remote Agent Server executor. */
export function createLarkupAgentToolExecutor(
  options: LarkupAgentClientOptions = {},
): (input: LarkupAgentToolInput) => Promise<string> {
  return new LarkupAgentClient(options).asAiSdkToolExecutor();
}
