/**
 * The channel dispatcher — one pipeline every transport shares.
 *
 * ```
 * inbound → verify → parse → idempotency claim → run agent → deliver (retry) → ack
 * ```
 *
 * Keeping this here rather than in each adapter is the point of the package: a
 * new channel supplies four small functions and inherits verification ordering,
 * de-duplication, the non-streaming fallback, retry/rate-limit handling, and
 * consistent observability events.
 */

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

/** Structured event stream, consumed by the observability layer in TASK 08. */
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

  // 1. Verify before anything expensive. A webhook URL is public.
  const verification = adapter.verify(request, settings);
  if (!verification.ok) {
    onEvent({ type: 'rejected', reason: verification.reason, status: verification.status });
    return { status: verification.status, body: { ok: false, error: verification.reason } };
  }

  // 2. Normalize. `null` means a valid event with nothing to answer.
  let message: NormalizedMessage | null;
  try {
    message = adapter.parse(request, settings);
  } catch (error) {
    // A payload we cannot read is not worth a retry storm: acknowledge it.
    onEvent({ type: 'ignored', reason: error instanceof Error ? error.message : String(error) });
    return { status: 200, body: { ok: true, detail: 'unparsable payload ignored' } };
  }

  if (!message || !message.text.trim()) {
    onEvent({ type: 'ignored', reason: 'no answerable content' });
    return { status: 200, body: { ok: true, detail: 'ignored' } };
  }

  // 3. De-duplicate provider retries.
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

  // 4. Run the agent. Buffered: no transport in the delivery order streams.
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
    // Release the claim so the provider's retry gets a real second attempt.
    await idempotency.release(key);
    const detail = error instanceof Error ? error.message : String(error);
    onEvent({ type: 'run.failed', error: detail });
    return { status: 500, body: { ok: false, error: detail } };
  }

  if (!answer) {
    onEvent({ type: 'ignored', reason: 'agent produced no text' });
    return { status: 200, body: { ok: true, detail: 'empty answer' } };
  }

  // 5. Deliver, honouring provider rate limits.
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
    // The answer exists but never arrived. Report 502 so the provider retries
    // and the dashboard can surface a delivery failure rather than silence.
    await idempotency.release(key);
    return { status: 502, body: { ok: false, error: delivery.error } };
  }

  onEvent({ type: 'delivered', externalMessageId: delivery.externalMessageId });
  return { status: 200, body: { ok: true } };
}
