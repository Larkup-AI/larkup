/**
 * @larkup/channels-core — the normalized channel adapter contract.
 *
 * A **channel** maps an external conversation transport (Telegram, Slack, a
 * plain webhook) onto the Agent Runtime protocol. Plan §9: every transport is
 * its own package implementing this one interface, so a channel is something
 * that can be tested in isolation rather than a button in the dashboard that
 * says "Connected".
 *
 * Two rules the contract exists to enforce:
 *
 * 1. **No channel talks to a Knowledge Server.** A channel produces a
 *    normalized message and hands it to the Agent Runtime; retrieval is the
 *    runtime's business (plan §1.1, §3.2).
 * 2. **Inbound requests are verified before they cost anything.** A webhook URL
 *    is public. Verification runs before the agent, the model, or any tool.
 */

/* ------------------------------------------------------------------ */
/* Inbound                                                             */
/* ------------------------------------------------------------------ */

/** A transport-agnostic view of the inbound HTTP request. */
export interface InboundRequest {
  method: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Raw body text — adapters that verify signatures need the exact bytes. */
  rawBody: string;
  /** Parsed JSON body, or undefined when the body was not JSON. */
  body?: unknown;
  /** Query parameters from the webhook URL. */
  query: Record<string, string>;
}

/** Result of verifying an inbound request's authenticity. */
export type VerificationResult = { ok: true } | { ok: false; status: 401 | 403; reason: string };

/**
 * A message normalized out of a provider payload.
 *
 * `null` from `parse()` means "valid request, nothing to answer" — a Telegram
 * edit notification, a Slack bot echo, a delivery receipt. Those must be
 * acknowledged with 200 and ignored, never retried.
 */
export interface NormalizedMessage {
  /** Provider's own message id, used for idempotency. */
  externalMessageId: string;
  /** Stable id for the conversation this message belongs to. */
  conversationId: string;
  /** Stable id for the end user, scoped to the channel. */
  endUserId: string;
  /** Display name, when the provider supplies one. */
  endUserName?: string;
  /** The user's text. Attachments are summarized into it for now. */
  text: string;
  /** Attachments the provider reported, normalized. */
  attachments?: NormalizedAttachment[];
  /** Anything the adapter needs to route the reply back. */
  replyContext: Record<string, string | number>;
}

export interface NormalizedAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  mimeType?: string;
  fileName?: string;
  /** Provider file id, for adapters that need a second call to fetch it. */
  externalId?: string;
}

/* ------------------------------------------------------------------ */
/* Outbound                                                            */
/* ------------------------------------------------------------------ */

/** The agent's reply, ready to be delivered. */
export interface OutboundMessage {
  conversationId: string;
  text: string;
  replyContext: Record<string, string | number>;
}

export type DeliveryResult =
  | { ok: true; externalMessageId?: string }
  | {
      ok: false;
      /** Human-readable failure, safe to store on the agent's channel config. */
      error: string;
      /** True when the caller should retry after `retryAfterMs`. */
      retryable: boolean;
      retryAfterMs?: number;
    };

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * One configurable field. Drives the dashboard form — plan §4.2: a publisher
 * must never have to hand-write a settings page.
 */
export interface ChannelConfigField {
  key: string;
  label: string;
  /** `secret` fields are write-only in the dashboard and masked on read. */
  type: 'text' | 'secret' | 'url' | 'boolean';
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface ChannelHealth {
  status: 'ok' | 'misconfigured' | 'unreachable';
  /** One line the dashboard can show verbatim. */
  detail: string;
  /** Provider-reported identity, e.g. a bot's @username. */
  identity?: string;
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

export interface ChannelAdapter {
  /** Stable id, used in the webhook path: `/api/agents/:id/channels/:channelId`. */
  id: string;
  name: string;
  description: string;

  /** Fields the dashboard renders and validates before storing. */
  configFields: ChannelConfigField[];

  /**
   * Does this transport support incremental delivery?
   *
   * Almost none do. When false the dispatcher buffers the whole agent response
   * and sends it as one message (plan §9: "non-streaming fallback").
   */
  supportsStreaming: boolean;

  /** Authenticate the inbound request. Runs before anything expensive. */
  verify(request: InboundRequest, settings: Record<string, string>): VerificationResult;

  /** Normalize the payload, or return null for an event with no reply. */
  parse(request: InboundRequest, settings: Record<string, string>): NormalizedMessage | null;

  /** Deliver the agent's reply. */
  send(message: OutboundMessage, settings: Record<string, string>): Promise<DeliveryResult>;

  /** Probe the provider so the dashboard can show a real status. */
  health(settings: Record<string, string>): Promise<ChannelHealth>;

  /**
   * Optional: tell the provider where to send updates. Called when an operator
   * enables the channel and the public URL is known.
   */
  registerWebhook?(
    webhookUrl: string,
    settings: Record<string, string>,
  ): Promise<{ ok: boolean; detail: string }>;
}
