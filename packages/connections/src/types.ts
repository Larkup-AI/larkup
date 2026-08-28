/** Normalized contracts for external message providers. */

/** Provider-neutral inbound HTTP request. */
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

/** Inbound request verification result. */
export type VerificationResult = { ok: true } | { ok: false; status: 401 | 403; reason: string };

/** Provider response sent before normal message dispatch. */
export interface InboundInterception {
  body: unknown;
  status?: number;
  /** Dispatch normally after acknowledging the provider. */
  dispatch?: boolean;
}

/** Provider message normalized for runtime dispatch. */
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

/** Field rendered by the connection form. */
export interface ChannelConfigField {
  key: string;
  label: string;
  /** `secret` fields are write-only in the dashboard and masked on read. */
  type: 'text' | 'secret' | 'url' | 'boolean';
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Where an operator gets this credential from the provider, if there is one link that helps. */
  helpUrl?: string;
  /** True when any random string satisfies this field — the dashboard can offer to generate one. */
  canGenerate?: boolean;
  /** Stored by an OAuth callback but never shown as a manual credential input. */
  hidden?: boolean;
}

export interface ChannelHealth {
  status: 'ok' | 'misconfigured' | 'unreachable';
  /** One line the dashboard can show verbatim. */
  detail: string;
  /** Provider-reported identity, e.g. a bot's @username. */
  identity?: string;
  /** Provider-stable bot or application id, if one is available. */
  externalId?: string;
  /** A safe URL where an operator can open the connected provider identity. */
  testUrl?: string;
  /** Optional provider-owned label for the safe test URL. */
  testUrlLabel?: string;
}

export interface ChannelAdapter {
  /** Stable provider id used by connection routes and storage. */
  id: string;
  name: string;
  description: string;
  /** Dashboard icon, as a path the web app's public/ directory serves. */
  icon: string;

  /** Fields the dashboard renders and validates before storing. */
  configFields: ChannelConfigField[];

  /** One line telling the operator how to confirm the channel actually works, once saved. */
  testHint?: string;

  /** Provider-specific steps the dashboard shows after it creates the connection. */
  setupInstructions?: string[];

  /** Optional managed OAuth connection. */
  oauthConnect?: {
    label: string;
    /** Provider-specific authorization description. */
    description?: string;
    /** Short reassurance displayed below the authorization action. */
    completionHint?: string;
    /** Managed proxy provider id; defaults to this channel's id. */
    managedProviderId?: string;
    /** Maps OAuth callback parameters to configuration fields. */
    callbackFields: Record<string, string>;
  };

  /** Shared OAuth credentials are verified by Larkup's managed channel proxy. */
  managedConnection?: {
    /** Required configuration that stays on the managed proxy, never in a Project. */
    sharedSecretField?: string;
    /** Request headers the managed proxy needs to verify an inbound event. */
    signatureHeaders?: string[];
    /** Per-installation relay settings. */
    relay?: {
      workspaceIdField: string;
      relaySecretField: string;
    };
  };

  /** Provider-owned copy for the reusable connection form. */
  connectionUi?: {
    credentialsDescription?: string;
    endpointHint?: string;
    /** True when a local Larkup app needs public HTTPS ingress for this provider. */
    requiresPublicIngress?: boolean;
    /** Explains how the secure public tunnel is used for this provider. */
    publicIngressDescription?: string;
    /** Plain-language instructions for people who will talk to the connected Agent. */
    contact?: {
      mention?: string;
      directMessage: string;
      channelMessage?: string;
    };
  };

  /** A provider URL where an operator can send a real message after setup. */
  testUrl?: string;

  /** Whether this transport supports incremental delivery. */
  supportsStreaming: boolean;

  /** Authenticate the inbound request. Runs before anything expensive. */
  verify(request: InboundRequest, settings: Record<string, string>): VerificationResult;

  /** Handle a verified control request, or return null. */
  interceptInbound?(request: InboundRequest): InboundInterception | null;

  /** Normalize the payload, or return null for an event with no reply. */
  parse(request: InboundRequest, settings: Record<string, string>): NormalizedMessage | null;

  /** Deliver the agent's reply. */
  send(message: OutboundMessage, settings: Record<string, string>): Promise<DeliveryResult>;

  /** Probe the provider so the dashboard can show a real status. */
  health(settings: Record<string, string>): Promise<ChannelHealth>;

  /** Register the public inbound webhook with the provider. */
  registerWebhook?(
    webhookUrl: string,
    settings: Record<string, string>,
  ): Promise<{ ok: boolean; detail: string }>;
}
