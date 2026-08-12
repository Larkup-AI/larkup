/**
 * Agent wire protocol — the shape of a chat request body.
 *
 * Plan §3.2: the Widget, React SDK, backend SDK, playground, and every channel
 * adapter call *one* Agent Runtime protocol. Those callers do not agree on a
 * message shape, though:
 *
 * - The JavaScript/Python SDKs and channel adapters send flat
 *   `{ role, content }` messages (this is what TASK 04 shipped).
 * - The AI SDK `useChat()` hook — which the Widget uses — sends `UIMessage`s
 *   with a `parts` array.
 *
 * Rather than force one of them to convert, the runtime accepts both and
 * normalizes here. Keeping the normalizer in contracts (instead of the runtime)
 * means generated agent servers get the same behavior for free.
 */

/** A normalized message the Agent Runtime can hand to the model. */
export interface AgentWireMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** A single part of an AI SDK `UIMessage`. */
interface UIMessagePart {
  type?: string;
  text?: string;
  /** Present on incremental `text-delta` parts. */
  delta?: string;
}

/** Either accepted inbound message shape. */
interface InboundMessage {
  role?: unknown;
  content?: unknown;
  parts?: unknown;
}

function normalizeRole(role: unknown): AgentWireMessage['role'] | null {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  // AI SDK v4 and some channels used "ai"/"bot" for the model turn.
  if (role === 'ai' || role === 'bot' || role === 'model') return 'assistant';
  return null;
}

/**
 * Flatten a `UIMessage.parts` array to plain text.
 *
 * Only text-bearing parts contribute. Tool calls, files, reasoning, and data
 * parts are deliberately dropped: replaying them as text would let a client
 * forge tool results, and the runtime re-derives them from its own execution.
 */
function flattenParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((raw) => {
      if (typeof raw === 'string') return raw;
      if (!raw || typeof raw !== 'object') return '';
      const part = raw as UIMessagePart;
      if (part.type === 'text' || part.type === 'text-delta' || part.type === undefined) {
        return part.text ?? part.delta ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('')
    .trim();
}

/**
 * Convert an arbitrary inbound `messages` payload into `AgentWireMessage[]`.
 *
 * Messages with an unknown role or no text survive as nothing — they are
 * dropped rather than throwing, so one malformed entry cannot fail a whole
 * conversation.
 */
export function normalizeAgentMessages(messages: unknown): AgentWireMessage[] {
  if (!Array.isArray(messages)) return [];

  const normalized: AgentWireMessage[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const message = raw as InboundMessage;

    const role = normalizeRole(message.role);
    if (!role) continue;

    const content =
      typeof message.content === 'string' && message.content.trim()
        ? message.content
        : flattenParts(message.parts);

    if (!content) continue;
    normalized.push({ role, content });
  }
  return normalized;
}

/** The most recent user turn, used as the retrieval query. */
export function lastUserMessage(messages: readonly AgentWireMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}
