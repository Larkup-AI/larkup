/** Shared inbound pipeline for every channel adapter. */

import { MemoryIdempotencyStore, idempotencyKey, type IdempotencyStore } from './idempotency';
import { deriveSession } from './session';
import { deliverWithRetry, type RetryOptions } from './retry';
import type { ChannelAdapter, InboundRequest, NormalizedMessage } from './types';

/** What the dispatcher needs from the Agent Runtime. */
export type RunAgent = (input: {
  agentId: string;
  sessionId: string;
  endUserId: string;
  message: string;
}) => Promise<{ text: string }>;

/** Events emitted by the dispatch pipeline. */
export type ChannelEvent =
  | { type: 'rejected'; reason: string; status: number }
  | { type: 'ignored'; reason: string }
  | { type: 'duplicate'; key: string }
  | { type: 'run.started'; sessionId: string }
  | { type: 'run.failed'; error: string }
  | { type: 'delivered'; externalMessageId?: string }
  | { type: 'delivery.failed'; error: string; retryable: boolean };

export interface DispatchOptions {
  adapter: ChannelAdapter;
  agentId: string;
  settings: Record<string, string>;
  request: InboundRequest;
  runAgent: RunAgent;
  idempotency?: IdempotencyStore;
  /** How long a processed message id is remembered. */
  idempotencyTtlMs?: number;
  retry?: RetryOptions;
  onEvent?: (event: ChannelEvent) => void;
}

export interface DispatchResult {
  /** Status to answer the provider's webhook with. */
  status: number;
  /** Body to answer with. Kept minimal — providers ignore it. */
  body: { ok: boolean; error?: string; detail?: string };
}

const sharedStore = new MemoryIdempotencyStore();

export async function dispatchInbound(options: DispatchOptions): Promise<DispatchResult> {
  const {
    adapter,
    agentId,
    settings,
    request,
    runAgent,
    idempotency = sharedStore,
    idempotencyTtlMs = 10 * 60 * 1000,
    retry,
    onEvent = () => {},
  } = options;

  // Verify before runtime work.
  const verification = adapter.verify(request, settings);
  if (!verification.ok) {
    onEvent({ type: 'rejected', reason: verification.reason, status: verification.status });
    return { status: verification.status, body: { ok: false, error: verification.reason } };
  }

  // Normalize valid events that require no response.
  let message: NormalizedMessage | null;
  try {
    message = adapter.parse(request, settings);
  } catch (error) {
    // Acknowledge unreadable payloads to prevent provider retries.
    onEvent({ type: 'ignored', reason: error instanceof Error ? error.message : String(error) });
    return { status: 200, body: { ok: true, detail: 'unparsable payload ignored' } };
  }

  if (!message || !message.text.trim()) {
    onEvent({ type: 'ignored', reason: 'no answerable content' });
    return { status: 200, body: { ok: true, detail: 'ignored' } };
  }

  // De-duplicate provider retries.
  const key = idempotencyKey(agentId, adapter.id, message.externalMessageId);
  if (!(await idempotency.claim(key, idempotencyTtlMs))) {
    onEvent({ type: 'duplicate', key });
    return { status: 200, body: { ok: true, detail: 'duplicate ignored' } };
  }

  const session = deriveSession({
    agentId,
    channelId: adapter.id,
    conversationId: message.conversationId,
    endUserId: message.endUserId,
  });

  // Run the agent before delivery.
  let answer: string;
  try {
    onEvent({ type: 'run.started', sessionId: session.sessionId });
    const result = await runAgent({
      agentId,
      sessionId: session.sessionId,
      endUserId: session.endUserId,
      message: message.text,
    });
    answer = result.text.trim();
  } catch (error) {
    // Let provider retries attempt transient runtime failures.
    await idempotency.release(key);
    const detail = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'run.failed', error: detail });
    return { status: 500, body: { ok: false, error: detail } };
  }

  if (!answer) {
    onEvent({ type: 'ignored', reason: 'agent produced no text' });
    return { status: 200, body: { ok: true, detail: 'empty answer' } };
  }

  // Deliver while respecting provider rate limits.
  const delivery = await deliverWithRetry(
    () =>
      adapter.send(
        {
          conversationId: message.conversationId,
          text: answer,
          replyContext: message.replyContext,
        },
        settings,
      ),
    retry,
  );

  if (!delivery.ok) {
    onEvent({ type: 'delivery.failed', error: delivery.error, retryable: delivery.retryable });
    // Release the claim so the provider can retry delivery.
    await idempotency.release(key);
    return { status: 502, body: { ok: false, error: delivery.error } };
  }

  onEvent({ type: 'delivered', externalMessageId: delivery.externalMessageId });
  return { status: 200, body: { ok: true } };
}
