/**
 * @larkup/agent-contracts — observability event model (plan §12).
 *
 * Observability is part of the runtime contract, not a dashboard feature. A
 * deployed agent that answers wrongly, costs too much, or stops responding has
 * to be diagnosable from its own output — which means the event shape is
 * something every runtime, channel, and deployment target agrees on.
 *
 * Two hard rules encoded here:
 *
 * 1. **No secrets, ever.** {@link redactEventPayload} scrubs anything that
 *    looks like a credential before an event is emitted. Logs get copied into
 *    ticket systems and support threads; a leaked key there is a real incident.
 * 2. **Correlation over volume.** Every event carries the ids that let an
 *    operator reconstruct one request: workspace, agent, release, session, run,
 *    channel, tool invocation.
 */

/** Correlation ids attached to every event. All optional but the agent. */
export interface EventCorrelation {
  agentId: string;
  releaseId?: string;
  sessionId?: string;
  /** One agent turn. */
  runId?: string;
  channelId?: string;
  toolInvocationId?: string;
  workspaceId?: string;
}

export type AgentEventName =
  // Run lifecycle
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  // Model
  | 'model.called'
  // Retrieval
  | 'retrieval.completed'
  // Tools
  | 'tool.invoked'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.refused'
  // Channels
  | 'channel.received'
  | 'channel.delivered'
  | 'channel.delivery_failed'
  // Deployment
  | 'deployment.started'
  | 'deployment.succeeded'
  | 'deployment.failed'
  | 'deployment.rolled_back'
  // Security
  | 'security.origin_denied'
  | 'security.auth_failed'
  | 'security.permission_denied'
  | 'security.config_changed';

export interface AgentEvent {
  name: AgentEventName;
  /** ISO-8601. */
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  correlation: EventCorrelation;
  /** Milliseconds, for events that measure something. */
  durationMs?: number;
  /** Event-specific fields. Redacted before emission. */
  payload?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

const SECRET_KEY_PATTERN = /(token|secret|key|password|authorization|credential|cookie|signature)/i;

/** Values that look like credentials regardless of their key. */
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  // Telegram bot token. No word boundaries: the token's most common appearance
  // is inside an API URL (`…/bot123456789:AAH…/sendMessage`), where a leading
  // `\b` never matches because `t` and `1` are both word characters.
  /\d{6,}:[A-Za-z0-9_-]{30,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
];

const REDACTED = '[redacted]';

function scrubString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Deep-redact an event payload.
 *
 * Keys whose name suggests a credential are dropped entirely; remaining strings
 * are scanned for credential-shaped values, which catches a token pasted into a
 * free-text error message. Depth is bounded so a cyclic or adversarial object
 * cannot hang the logger.
 */
export function redactEventPayload(payload: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;

  if (typeof payload === 'string') return scrubString(payload);
  if (payload === null || typeof payload !== 'object') return payload;

  if (Array.isArray(payload)) {
    return payload.slice(0, 50).map((item) => redactEventPayload(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactEventPayload(value, depth + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Emitter                                                             */
/* ------------------------------------------------------------------ */

export type EventSink = (event: AgentEvent) => void;

/**
 * Structured JSON to stdout — the lowest common denominator that every target
 * in plan §11 can collect: Docker, Cloud Run, Container Apps, ECS.
 *
 * An OTLP sink plugs in through {@link setEventSink}; the event shape above is
 * already OpenTelemetry-compatible (name, timestamp, attributes).
 */
export const consoleSink: EventSink = (event) => {
  const line = JSON.stringify(event);
  if (event.level === 'error') console.error(line);
  else if (event.level === 'warn') console.warn(line);
  else console.log(line);
};

let sink: EventSink = consoleSink;

/** Replace the sink. Self-hosted deployments opt in to remote export. */
export function setEventSink(next: EventSink): void {
  sink = next;
}

/** Emit an event, redacting its payload first. */
export function emitAgentEvent(
  name: AgentEventName,
  correlation: EventCorrelation,
  options: {
    level?: AgentEvent['level'];
    durationMs?: number;
    payload?: Record<string, unknown>;
  } = {},
): void {
  const event: AgentEvent = {
    name,
    timestamp: new Date().toISOString(),
    level: options.level ?? (name.endsWith('failed') || name.endsWith('denied') ? 'warn' : 'info'),
    correlation,
    ...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
    ...(options.payload
      ? { payload: redactEventPayload(options.payload) as Record<string, unknown> }
      : {}),
  };

  try {
    sink(event);
  } catch {
    // Telemetry must never break the request it is describing.
  }
}

/** Start a timer whose `end()` emits a completion event with a duration. */
export function startTimer(): { elapsedMs: () => number } {
  const startedAt = Date.now();
  return { elapsedMs: () => Date.now() - startedAt };
}
