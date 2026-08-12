/**
 * Generic Webhook channel.
 *
 * The transport for anything that is not a named provider: an internal helpdesk,
 * a CRM automation, a mobile backend. The customer's system POSTs a message and
 * receives the answer, either synchronously in the response or by callback.
 *
 * Verification is an HMAC over the raw body. That choice is deliberate: a shared
 * bearer token is simpler, but it is replayable forever and tends to end up in a
 * URL. The HMAC scheme here matches what Slack, Stripe, and GitHub do, so an
 * integrator can reuse code they already have.
 *
 *     signature = hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))
 *     headers:  X-Larkup-Timestamp, X-Larkup-Signature
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  DeliveryResult,
  InboundRequest,
  NormalizedMessage,
  OutboundMessage,
  VerificationResult,
} from '../types';
import { parseRetryAfter } from '../retry';

/** Requests older than this are rejected, so a captured body cannot be replayed. */
const MAX_SKEW_MS = 5 * 60 * 1000;

export function computeWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

interface WebhookPayload {
  message?: unknown;
  text?: unknown;
  messageId?: unknown;
  conversationId?: unknown;
  userId?: unknown;
  userName?: unknown;
}

export const webhookChannel: ChannelAdapter = {
  id: 'webhook',
  name: 'Webhook',
  description:
    'Send a message from any backend and receive the agent’s answer. Signed with HMAC-SHA256.',
  supportsStreaming: false,

  configFields: [
    {
      key: 'signingSecret',
      label: 'Signing secret',
      type: 'secret',
      required: true,
      help: 'Sign requests as hex(hmac_sha256(secret, `${timestamp}.${body}`)) and send X-Larkup-Timestamp and X-Larkup-Signature.',
    },
    {
      key: 'callbackUrl',
      label: 'Callback URL',
      type: 'url',
      required: false,
      placeholder: 'https://your-system.example.com/larkup/reply',
      help: 'Optional. When set, the answer is POSTed here as well as returned in the response.',
    },
  ],

  verify(request: InboundRequest, settings): VerificationResult {
    const secret = settings.signingSecret?.trim();
    if (!secret) {
      return { ok: false, status: 403, reason: 'Channel is not configured with a signing secret.' };
    }

    const timestamp = request.headers['x-larkup-timestamp'];
    const signature = request.headers['x-larkup-signature'];
    if (!timestamp || !signature) {
      return {
        ok: false,
        status: 401,
        reason: 'Missing X-Larkup-Timestamp or X-Larkup-Signature header.',
      };
    }

    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_SKEW_MS) {
      return {
        ok: false,
        status: 401,
        reason: 'Signature timestamp is missing, invalid, or stale.',
      };
    }

    const expected = computeWebhookSignature(secret, timestamp, request.rawBody);
    if (!safeEqual(expected, signature.trim().toLowerCase())) {
      return { ok: false, status: 401, reason: 'Signature does not match.' };
    }

    return { ok: true };
  },

  parse(request: InboundRequest): NormalizedMessage | null {
    const body = (request.body ?? {}) as WebhookPayload;
    const text = typeof body.message === 'string' ? body.message : body.text;
    if (typeof text !== 'string' || !text.trim()) return null;

    const conversationId =
      typeof body.conversationId === 'string' && body.conversationId
        ? body.conversationId
        : 'default';

    return {
      externalMessageId:
        typeof body.messageId === 'string' && body.messageId
          ? body.messageId
          : // No id supplied: fall back to the signature, which is unique per
            // (timestamp, body) and therefore de-duplicates honest retries.
            request.headers['x-larkup-signature'] ?? `${Date.now()}`,
      conversationId,
      endUserId: typeof body.userId === 'string' && body.userId ? body.userId : conversationId,
      endUserName: typeof body.userName === 'string' ? body.userName : undefined,
      text: text.trim(),
      replyContext: { conversationId },
    };
  },

  async send(message: OutboundMessage, settings): Promise<DeliveryResult> {
    const callbackUrl = settings.callbackUrl?.trim();

    // No callback configured: the answer travels back in the HTTP response,
    // which the route attaches. Nothing to deliver out-of-band.
    if (!callbackUrl) return { ok: true };

    const timestamp = String(Date.now());
    const payload = JSON.stringify({
      conversationId: message.conversationId,
      reply: message.text,
    });

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Larkup-Timestamp': timestamp,
        // The callback is signed with the same secret, so the receiver can
        // verify it came from this Larkup instance.
        'X-Larkup-Signature': computeWebhookSignature(
          settings.signingSecret ?? '',
          timestamp,
          payload,
        ),
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return { ok: true };

    return {
      ok: false,
      error: `Callback returned HTTP ${response.status}.`,
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    };
  },

  async health(settings) {
    if (!settings.signingSecret?.trim()) {
      return { status: 'misconfigured', detail: 'No signing secret set.' };
    }
    if (!settings.callbackUrl?.trim()) {
      return {
        status: 'ok',
        detail: 'Ready. Answers are returned in the webhook response.',
      };
    }
    return { status: 'ok', detail: `Ready. Answers are also POSTed to ${settings.callbackUrl}.` };
  },
};
