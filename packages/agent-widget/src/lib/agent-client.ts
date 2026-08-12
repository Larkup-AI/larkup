/**
 * Network layer: the only two calls the widget ever makes.
 *
 * Both are cross-origin by nature (the widget runs on the customer's site, the
 * agent runs on the Larkup host), so both are subject to the agent's
 * `allowedOrigins` list. A 403 here is the expected, designed outcome of an
 * un-allow-listed embed — it must produce an actionable message, not a silent
 * failure.
 */

import type { PublicAgentConfig, WidgetConfig } from '../types';
import { applyChunk, createTurnState, parseSseBuffer, type TurnState } from './ui-message-stream';

/** An error that carries the HTTP status, so callers can special-case 403. */
export class AgentRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

function authHeaders(config: WidgetConfig): Record<string, string> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (config.joinCode) headers['X-Larkup-Join-Code'] = config.joinCode;
  return headers;
}

async function errorFrom(response: Response, fallback: string): Promise<AgentRequestError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === 'string') detail = body.error;
  } catch {
    // Non-JSON error body (a proxy or CDN page); fall through to the default.
  }
  return new AgentRequestError(detail || `${fallback} (HTTP ${response.status})`, response.status);
}

/**
 * Run a request, converting an opaque network rejection into something an
 * embedder can act on.
 *
 * A cross-origin `fetch` that never reaches the server — wrong host, server
 * down, blocked by an extension or a CSP — rejects with a bare
 * `TypeError: Failed to fetch`, with no status and no body. Showing that string
 * in a chat panel helps nobody, so it is replaced with the two things worth
 * checking.
 */
async function request(url: string, init: RequestInit, host: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AgentRequestError(
      `Could not reach the Larkup server at ${host}. Check that the host is correct and reachable from this page.`,
      0,
    );
  }
}

/** Fetch the redacted public view of the agent. */
export async function fetchPublicConfig(
  config: WidgetConfig,
  signal?: AbortSignal,
): Promise<PublicAgentConfig> {
  const url = `${config.host}/api/agents/${encodeURIComponent(config.agentId)}/public`;
  const response = await request(url, { headers: authHeaders(config), signal }, config.host);

  if (!response.ok) {
    if (response.status === 403) {
      throw new AgentRequestError(
        `This site (${location.origin}) is not in the agent's allowed origins. Add it in Larkup → Settings → Agents → Connect.`,
        403,
      );
    }
    if (response.status === 404) {
      throw new AgentRequestError(
        `Agent "${config.agentId}" was not found on ${config.host}.`,
        404,
      );
    }
    throw await errorFrom(response, 'Could not load the agent');
  }

  return (await response.json()) as PublicAgentConfig;
}

export interface StreamChatOptions {
  config: WidgetConfig;
  messages: { role: 'user' | 'assistant'; content: string }[];
  signal?: AbortSignal;
  /** Called on every state change so the UI can render partial output. */
  onUpdate: (state: TurnState) => void;
}

/**
 * POST a turn and stream the reply.
 *
 * Messages are sent in the flat `{ role, content }` shape the Agent Runtime has
 * accepted since TASK 04; the runtime normalizes both that and AI SDK
 * `UIMessage`s, so the widget stays on the simpler one.
 */
export async function streamChat(options: StreamChatOptions): Promise<TurnState> {
  const { config, messages, signal, onUpdate } = options;
  const url = `${config.host}/api/agents/${encodeURIComponent(config.agentId)}/chat`;

  const response = await request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({ messages }),
      signal,
    },
    config.host,
  );

  if (!response.ok) {
    if (response.status === 403) {
      throw new AgentRequestError(
        `This site (${location.origin}) is not allowed to chat with this agent.`,
        403,
      );
    }
    if (response.status === 409) {
      throw new AgentRequestError(
        'This agent has no published release yet. Publish one in Larkup → Settings → Agents.',
        409,
      );
    }
    if (response.status === 429) {
      // One fixed message regardless of which of the three plan §8.5 limits
      // tripped (requests/minute, messages/session, daily token ceiling) —
      // a visitor cannot act on the difference, and an operator has
      // `Retry-After`/`X-RateLimit-Remaining` and the server logs for that.
      throw new AgentRequestError('Too many messages — try again in a minute.', 429);
    }
    throw await errorFrom(response, 'The agent could not answer');
  }

  if (!response.body) {
    throw new AgentRequestError('The agent returned an empty response stream.', 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let state = createTurnState();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;

      let changed = false;
      for (const chunk of parsed.chunks) {
        const next = applyChunk(state, chunk);
        if (next !== state) {
          state = next;
          changed = true;
        }
      }
      if (changed) onUpdate(state);
      if (parsed.done) break;
    }
  } finally {
    // Releasing matters on abort: an un-released reader keeps the connection
    // (and the server-side model call) alive after the user closes the widget.
    reader.releaseLock();
    if (signal?.aborted) await response.body.cancel().catch(() => {});
  }

  if (!state.finished) {
    state = { ...state, finished: true };
    onUpdate(state);
  }
  return state;
}
