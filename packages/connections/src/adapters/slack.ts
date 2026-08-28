/** Slack Events API adapter. */

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

/** Maximum accepted signature age. */
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

/** Split text within Slack's message limit. */
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

/** Returns Slack's verified URL-validation response. */
export function slackUrlVerificationChallenge(body: unknown): { challenge: string } | null {
  const envelope = body as SlackEnvelope | undefined;
  if (envelope?.type !== 'url_verification' || typeof envelope.challenge !== 'string') return null;
  return { challenge: envelope.challenge };
}

export const slackChannel: ChannelAdapter = {
  id: 'slack',
  name: 'Slack',
  description: 'Answer messages sent to a Slack app, in a DM or any channel it is invited to.',
  icon: '/icons/slack.png',
  testHint: 'DM the app or @mention it in a channel it has been added to.',
  setupInstructions: [
    'In your Slack app, open Event Subscriptions, enable events, and paste this URL as the Request URL.',
    'Subscribe to app_mention and message.im, then save. Reinstall the app if Slack asks.',
  ],
  testUrl: 'https://app.slack.com/client',
  oauthConnect: {
    label: 'Connect with Slack',
    description:
      'Install Larkup’s Slack app in a workspace. A workspace admin approves it; users never need to copy tokens or configure secrets.',
    completionHint:
      'OAuth saves this workspace’s Bot User OAuth Token. Larkup handles the shared app credentials and event verification.',
    callbackFields: {
      token: 'botToken',
      team_id: 'workspaceId',
      relay_secret: 'relaySecret',
    },
  },
  managedConnection: {
    sharedSecretField: 'signingSecret',
    signatureHeaders: ['x-slack-request-timestamp', 'x-slack-signature'],
    relay: {
      workspaceIdField: 'workspaceId',
      relaySecretField: 'relaySecret',
    },
  },
  connectionUi: {
    credentialsDescription:
      'Use this when connecting your own Slack app instead of Larkup’s managed connection.',
    requiresPublicIngress: true,
    publicIngressDescription:
      'Larkup Proxy securely forwards Slack messages to this HTTPS address after you connect. You never need to paste this address into Slack.',
    endpointHint:
      'This can stay local while testing. Slack needs the public webhook URL shown after you save, not direct access to this Agent endpoint.',
    contact: {
      directMessage:
        'Open a direct message with the Slack bot you just installed, then send it a message.',
      channelMessage:
        'Add the installed Slack bot to a channel, then @mention that bot in your message.',
    },
  },
  supportsStreaming: false,

  configFields: [
    {
      key: 'botToken',
      label: 'Bot User OAuth Token',
      type: 'secret',
      required: true,
      placeholder: 'xoxb-...',
      help: 'From OAuth & Permissions, after installing the app. Grants chat:write and whatever read scope matches the events you subscribe to.',
      helpUrl: 'https://api.slack.com/apps',
    },
    {
      key: 'signingSecret',
      label: 'Signing secret',
      type: 'secret',
      required: true,
      help: 'From Basic Information → App Credentials. Verifies every request actually came from Slack.',
      helpUrl: 'https://api.slack.com/apps',
    },
    {
      key: 'workspaceId',
      label: 'Slack workspace ID',
      type: 'text',
      required: false,
      hidden: true,
    },
    {
      key: 'relaySecret',
      label: 'Larkup relay secret',
      type: 'secret',
      required: false,
      hidden: true,
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

  interceptInbound(request) {
    const challenge = slackUrlVerificationChallenge(request.body);
    return challenge ? { body: challenge } : null;
  },

  parse(request: InboundRequest): NormalizedMessage | null {
    const envelope = (request.body ?? {}) as SlackEnvelope;
    const event = envelope.event;
    if (!event || (event.type !== 'message' && event.type !== 'app_mention')) return null;

    // Ignore edits, notices, and bot messages.
    if (event.subtype) return null;
    // Avoid bot-to-bot reply loops.
    if (event.bot_id) return null;

    const text = (event.text ?? '').replace(/<@[A-Z0-9]+>/gi, '').trim();
    if (!text || !event.channel || !event.user || !event.ts) return null;

    return {
      // Use Slack's delivery id to deduplicate retries.
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
  // hand. `interceptInbound` answers its url_verification handshake.
};
