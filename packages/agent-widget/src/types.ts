import type { AgentWidgetStyle } from '@larkup/agent-contracts/agent';

/** Re-exported so widget consumers do not need the contracts package. */
export type { AgentWidgetStyle };

/**
 * Everything the embedder can configure.
 *
 * Notice what is *absent*: there is no API key, model name, or provider field.
 * Per ADR-004 the browser holds a public Agent ID and nothing else — model
 * credentials, knowledge-server keys, and tool secrets never leave the server.
 */
export interface WidgetConfig {
  /** Public Agent ID, e.g. "support-bot-m1a2b3". Required. */
  agentId: string;
  /**
   * Origin of the Larkup server that runs the agent, e.g.
   * "https://agents.acme.com". Defaults to the origin the script was loaded
   * from, which is correct for the common single-server install.
   */
  host: string;
  /** Style overrides applied on top of the agent's dashboard-configured style. */
  style?: Partial<AgentWidgetStyle>;
  /** Open the panel immediately instead of showing only the bubble. */
  defaultOpen?: boolean;
  /** Join code for agents configured with `authMode: "join-code"`. */
  joinCode?: string;
  /**
   * Extra headers for every agent request — the hook for a short-lived
   * end-user JWT minted by the embedder's own backend. Never put a secret
   * Agent API key here; it would be readable by every visitor.
   */
  headers?: Record<string, string>;
  /** Where to mount. Defaults to a generated element appended to `<body>`. */
  target?: Element | string;
  /** Called once the widget has mounted. */
  onReady?: () => void;
  /** Called when the widget cannot start (bad ID, blocked origin, offline). */
  onError?: (error: Error) => void;
}

/**
 * The redacted agent view served by `GET /api/agents/:id/public`.
 *
 * This is the only agent data a browser is ever given.
 */
export interface PublicAgentConfig {
  agentId: string;
  name: string;
  description?: string;
  /** "ready" once a release is active; "needs_publish" while still a draft. */
  status: 'ready' | 'needs_publish';
  authMode: 'none' | 'api-key' | 'join-code';
  widgetStyle: AgentWidgetStyle;
}

/* ------------------------------------------------------------------ */
/* Conversation state                                                  */
/* ------------------------------------------------------------------ */

/** A rendered chat turn. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** Streamed answer text. */
  text: string;
  /** Structured blocks emitted alongside the text (ADR-005). */
  blocks: WidgetBlock[];
  /** True while the assistant turn is still streaming. */
  streaming?: boolean;
  /** Set when the turn failed; `text` then holds the user-facing message. */
  error?: boolean;
}

/**
 * The allow-listed render protocol.
 *
 * Plan §4.4: a marketplace extension must never be able to ship arbitrary
 * JavaScript or React into a customer's website. The widget therefore renders
 * only these shapes and ignores anything it does not recognize.
 */
export type WidgetBlockBody =
  | { type: 'status'; label: string; state: 'running' | 'done' | 'error' }
  | { type: 'citation'; label: string; url?: string }
  | { type: 'file'; url: string; mediaType: string; label?: string }
  | { type: 'data'; label: string; json: unknown }
  | { type: 'table'; columns: string[]; rows: (string | number | null)[][] };

/**
 * A block plus the stable identity used to update it in place — a tool's
 * status block flips from `running` to `done` on a later frame, so blocks
 * cannot be append-only.
 */
export type WidgetBlock = WidgetBlockBody & { key: string };
