/**
 * Slack channel.
 *
 * Slack signs every request to an Events API endpoint — including the
 * one-time URL-verification handshake — with `X-Slack-Signature: v0=<hex>`
 * over `v0:{timestamp}:{rawBody}`, HMAC-SHA256 with the app's Signing
 * Secret. Close enough to the generic webhook's scheme
 * (`../adapters/webhook.ts`) that `verify()` reuses the same timing-safe
 * compare and timestamp-skew replay guard.
 *
 * Not handled here: the `url_verification` handshake Slack sends once when
 * an operator saves the Events API Request URL. That needs to echo
 * `{ challenge }` in the response body — a shape `dispatchInbound`'s fixed
 * `{ ok, error?, detail? }` result was never meant to carry — so the inbound
 * route intercepts it before calling `dispatchInbound`, the same place it
 * already runs `adapter.verify()`. See `apps/web/app/api/agents/[agentId]/channels/[channelId]/route.ts`
 * and `slackUrlVerificationChallenge()` below.
 *
 * Also not handled: Slack's 3-second ack SLA. `dispatchInbound` runs the
 * whole agent turn synchronously, same as every other channel here — a slow
 * model call means Slack retries the event before this adapter answers.
 * Harmless: retries carry the same `event_id`, which the shared idempotency
 * store already de-duplicates (plan §9's dispatch pipeline). The user sees
 * one answer, arriving late rather than not at all. Telegram accepts the
 * identical trade-off; solving it (an immediate ack plus an async reply)
 * is a dispatcher-level change, not specific to this adapter.
 *
 * API reference: https://api.slack.com/apis/events-api
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

const API = 'https://slack.com/api';

/** Slack's documented ceiling for a `chat.postMessage` `text` field. */
const MAX_MESSAGE_LENGTH = 40_000;

/** Same replay-window reasoning as the generic webhook adapter. */
const MAX_SKEW_MS = 5 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

interface SlackEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
}

interface SlackEnvelope {
  type?: string;
  token?: string;
  challenge?: string;
  event_id?: string;
  event?: SlackEvent;
}

/** Split on paragraph, then line, then hard boundaries — same shape as Telegram's splitter. */
export function splitForSlack(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'));
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Is this the one-time `url_verification` handshake Slack sends when an
 * operator saves the Events API Request URL? If so, the response body Slack
 * requires to accept the URL.
 *
 * Called by the inbound route *after* `verify()` succeeds and *before*
 * `dispatchInbound` — this is not a message, has nothing to dispatch, and
 * needs a response shape (`{ challenge }`) the dispatcher's fixed result
 * type does not carry.
 */
export function slackUrlVerificationChallenge(body: unknown): { challenge: string } | null {
  const envelope = body as SlackEnvelope | undefined;
  if (envelope?.type !== 'url_verification' || typeof envelope.challenge !== 'string') return null;
  return { challenge: envelope.challenge };
}

export const slackChannel: ChannelAdapter = {
  id: 'slack',
  name: 'Slack',
  description: 'Answer messages sent to a Slack app, in a DM or any channel it is invited to.',
  supportsStreaming: false,

  configFields: [
    {
      key: 'botToken',
      label: 'Bot User OAuth Token',
      type: 'secret',
      required: true,
      placeholder: 'xoxb-...',
      help: 'From OAuth & Permissions, after installing the app. Grants chat:write and whatever read scope matches the events you subscribe to.',
    },
    {
      key: 'signingSecret',
      label: 'Signing secret',
      type: 'secret',
      required: true,
      help: 'From Basic Information → App Credentials. Verifies every request actually came from Slack.',
    },
  ],

  verify(request: InboundRequest, settings): VerificationResult {
    const secret = settings.signingSecret?.trim();
    if (!secret) {
      return { ok: false, status: 403, reason: 'Channel is not configured with a signing secret.' };
    }

    const timestamp = request.headers['x-slack-request-timestamp'];
    const signature = request.headers['x-slack-signature'];
    if (!timestamp || !signature) {
      return {
        ok: false,
        status: 401,
        reason: 'Missing X-Slack-Request-Timestamp or X-Slack-Signature header.',
      };
    }

    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt * 1000) > MAX_SKEW_MS) {
      return {
        ok: false,
        status: 401,
        reason: 'Signature timestamp is missing, invalid, or stale.',
      };
    }

    const expected =
      'v0=' +
      createHmac('sha256', secret).update(`v0:${timestamp}:${request.rawBody}`).digest('hex');
    if (!safeEqual(expected, signature.trim())) {
      return { ok: false, status: 401, reason: 'Signature does not match.' };
    }

    return { ok: true };
  },

  parse(request: InboundRequest): NormalizedMessage | null {
    const envelope = (request.body ?? {}) as SlackEnvelope;
    const event = envelope.event;
    if (!event || event.type !== 'message') return null;

    // A subtype means an edit, a delete, a channel-join notice, or a bot
    // message relayed with `subtype: 'bot_message'` — never something to
    // answer. A plain user message has no subtype at all.
    if (event.subtype) return null;
    // Belt and suspenders: some bot-posted messages carry `bot_id` without a
    // subtype. Answering them risks two bots looping forever.
    if (event.bot_id) return null;

    const text = (event.text ?? '').trim();
    if (!text || !event.channel || !event.user || !event.ts) return null;

    return {
      // Stable across Slack's retries of the same delivery (unlike `ts`,
      // which is per-message but does not identify the *event*) — exactly
      // what the shared idempotency store keys on.
      externalMessageId: envelope.event_id ?? `${event.channel}:${event.ts}`,
      conversationId: event.channel,
      endUserId: event.user,
      text,
      replyContext: { channel: event.channel },
    };
  },

  async send(message: OutboundMessage, settings): Promise<DeliveryResult> {
    const token = settings.botToken?.trim();
    if (!token) return { ok: false, error: 'No bot token configured.', retryable: false };

    const channel = message.replyContext.channel;
    const chunks = splitForSlack(message.text);
    let lastTs: string | undefined;

    for (const chunk of chunks) {
      const response = await fetch(`${API}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel, text: chunk }),
        signal: AbortSignal.timeout(15_000),
      });

      // Slack's Web API answers HTTP 200 even on failure — the real result
      // is `payload.ok`. A 429 is the one case with a non-200 status.
      if (response.status === 429) {
        return {
          ok: false,
          error: 'Slack rate-limited chat.postMessage.',
          retryable: true,
          retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        };
      }

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        ts?: string;
      } | null;

      if (!response.ok || !payload?.ok) {
        return {
          ok: false,
          // Slack's own error codes are short, stable strings ("not_in_channel",
          // "channel_not_found") — safe and useful to surface as-is.
          error: `Slack API error: ${payload?.error ?? `HTTP ${response.status}`}.`,
          retryable: response.status >= 500,
        };
      }

      lastTs = payload.ts;
    }

    return { ok: true, externalMessageId: lastTs };
  },

  async health(settings) {
    const token = settings.botToken?.trim();
    if (!token) return { status: 'misconfigured', detail: 'No bot token set.' };
    if (!settings.signingSecret?.trim()) {
      return { status: 'misconfigured', detail: 'No signing secret set.' };
    }

    try {
      const response = await fetch(`${API}/auth.test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        user?: string;
        team?: string;
      } | null;

      if (!response.ok || !payload?.ok) {
        const authError =
          payload?.error === 'invalid_auth' || payload?.error === 'account_inactive';
        return {
          status: authError ? 'misconfigured' : 'unreachable',
          detail: authError
            ? 'Slack rejected the bot token.'
            : `Slack API returned: ${payload?.error ?? `HTTP ${response.status}`}.`,
        };
      }

      const identity = payload.user ? `@${payload.user}` : undefined;
      return {
        status: 'ok',
        detail: identity
          ? `Connected as ${identity}${payload.team ? ` on ${payload.team}` : ''}.`
          : 'Connected.',
        identity,
      };
    } catch (error) {
      return {
        status: 'unreachable',
        detail: error instanceof Error ? error.message : 'Could not reach the Slack API.',
      };
    }
  },

  // No registerWebhook: Slack has no API to set the Events API Request URL —
  // an operator pastes it into the Slack app's Event Subscriptions page by
  // hand, which is also where Slack fires the url_verification handshake
  // this module's `slackUrlVerificationChallenge()` answers.
};
