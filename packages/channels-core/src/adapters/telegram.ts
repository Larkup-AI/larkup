/**
 * Telegram channel .
 *
 * Telegram has no request signing. Its documented mechanism is a secret token
 * echoed in `X-Telegram-Bot-Api-Secret-Token`, set when the webhook is
 * registered. That token is what `verify()` checks; without it the webhook URL
 * would be an open door for anyone who guesses an agent id.
 *
 * API reference: https://core.telegram.org/bots/api#setwebhook
 */

import { timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  DeliveryResult,
  InboundRequest,
  NormalizedAttachment,
  NormalizedMessage,
  OutboundMessage,
  VerificationResult,
} from '../types';
import { parseRetryAfter } from '../retry';

const API = 'https://api.telegram.org';

/** Telegram rejects a sendMessage body over 4096 characters. */
const MAX_MESSAGE_LENGTH = 4096;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id?: number;
  date?: number;
  text?: string;
  caption?: string;
  from?: { id?: number; is_bot?: boolean; first_name?: string; username?: string };
  chat?: { id?: number; type?: string };
  photo?: { file_id?: string }[];
  document?: { file_id?: string; file_name?: string; mime_type?: string };
  voice?: { file_id?: string; mime_type?: string };
  video?: { file_id?: string; mime_type?: string };
}

/** Split a long answer on paragraph, then line, then hard boundaries. */
export function splitForTelegram(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
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

function attachmentsOf(message: TelegramMessage): NormalizedAttachment[] {
  const attachments: NormalizedAttachment[] = [];

  const photo = message.photo?.[message.photo.length - 1];
  if (photo?.file_id) attachments.push({ type: 'image', externalId: photo.file_id });
  if (message.voice?.file_id) {
    attachments.push({
      type: 'audio',
      externalId: message.voice.file_id,
      mimeType: message.voice.mime_type,
    });
  }
  if (message.video?.file_id) {
    attachments.push({
      type: 'video',
      externalId: message.video.file_id,
      mimeType: message.video.mime_type,
    });
  }
  if (message.document?.file_id) {
    attachments.push({
      type: 'file',
      externalId: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
    });
  }

  return attachments;
}

export const telegramChannel: ChannelAdapter = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Answer messages sent to a Telegram bot.',
  supportsStreaming: false,

  configFields: [
    {
      key: 'botToken',
      label: 'Bot token',
      type: 'secret',
      required: true,
      placeholder: '123456789:AAH...',
      help: 'From @BotFather. Grants full control of the bot — treat it as a password.',
    },
    {
      key: 'webhookSecret',
      label: 'Webhook secret',
      type: 'secret',
      required: true,
      help: 'Any random string. Sent to Telegram at registration and checked on every update.',
    },
  ],

  verify(request: InboundRequest, settings): VerificationResult {
    const expected = settings.webhookSecret?.trim();
    if (!expected) {
      return { ok: false, status: 403, reason: 'Channel is not configured with a webhook secret.' };
    }

    const supplied = request.headers['x-telegram-bot-api-secret-token'];
    if (!supplied || !safeEqual(expected, supplied)) {
      return { ok: false, status: 401, reason: 'Invalid Telegram webhook secret token.' };
    }

    return { ok: true };
  },

  parse(request: InboundRequest): NormalizedMessage | null {
    const update = (request.body ?? {}) as TelegramUpdate;

    // Only fresh messages produce an answer. An edit or a channel post is a
    // valid update that must be acknowledged and ignored, or Telegram retries.
    const message = update.message;
    if (!message) return null;

    // Never answer another bot — two bots in a group would loop forever.
    if (message.from?.is_bot) return null;

    const text = (message.text ?? message.caption ?? '').trim();
    const attachments = attachmentsOf(message);
    if (!text && attachments.length === 0) return null;

    const chatId = message.chat?.id;
    if (chatId === undefined) return null;

    const from = message.from;
    const name = [from?.first_name, from?.username && `@${from.username}`]
      .filter(Boolean)
      .join(' ');

    return {
      externalMessageId: String(update.update_id ?? `${chatId}:${message.message_id}`),
      conversationId: String(chatId),
      endUserId: String(from?.id ?? chatId),
      endUserName: name || undefined,
      // Attachments are announced in text until media ingestion is wired to the
      // Knowledge Server; the agent should say what it can and cannot see
      // rather than silently ignoring a photo.
      text:
        text ||
        `[The user sent ${attachments.length} attachment(s): ${attachments
          .map((a) => a.type)
          .join(', ')}. You cannot open them yet — ask the user to describe or paste the content.]`,
      attachments: attachments.length ? attachments : undefined,
      replyContext: { chatId },
    };
  },

  async send(message: OutboundMessage, settings): Promise<DeliveryResult> {
    const token = settings.botToken?.trim();
    if (!token) return { ok: false, error: 'No bot token configured.', retryable: false };

    const chatId = message.replyContext.chatId;
    const chunks = splitForTelegram(message.text);
    let lastId: string | undefined;

    for (const chunk of chunks) {
      const response = await fetch(`${API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const retryAfter =
          parseRetryAfter(response.headers.get('retry-after')) ??
          (await retryAfterFromBody(response));

        return {
          ok: false,
          // Telegram's own error text is safe to surface: it says things like
          // "bot was blocked by the user", which is what an operator needs.
          error: `Telegram API returned HTTP ${response.status}${
            retryAfter ? ` (retry in ${Math.round(retryAfter / 1000)}s)` : ''
          }.`,
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: retryAfter,
        };
      }

      const payload = (await response.json().catch(() => null)) as {
        result?: { message_id?: number };
      } | null;
      if (payload?.result?.message_id !== undefined) lastId = String(payload.result.message_id);
    }

    return { ok: true, externalMessageId: lastId };
  },

  async health(settings) {
    const token = settings.botToken?.trim();
    if (!token) return { status: 'misconfigured', detail: 'No bot token set.' };
    if (!settings.webhookSecret?.trim()) {
      return { status: 'misconfigured', detail: 'No webhook secret set.' };
    }

    try {
      const response = await fetch(`${API}/bot${token}/getMe`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        return {
          status: response.status === 401 ? 'misconfigured' : 'unreachable',
          detail:
            response.status === 401
              ? 'Telegram rejected the bot token.'
              : `Telegram API returned HTTP ${response.status}.`,
        };
      }
      const payload = (await response.json()) as { result?: { username?: string } };
      const username = payload.result?.username;
      return {
        status: 'ok',
        detail: username ? `Connected as @${username}.` : 'Connected.',
        identity: username ? `@${username}` : undefined,
      };
    } catch (error) {
      return {
        status: 'unreachable',
        detail: error instanceof Error ? error.message : 'Could not reach the Telegram API.',
      };
    }
  },

  async registerWebhook(webhookUrl, settings) {
    const token = settings.botToken?.trim();
    if (!token) return { ok: false, detail: 'No bot token set.' };

    try {
      const response = await fetch(`${API}/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: settings.webhookSecret,
          // Only ask for what `parse()` acts on; fewer updates, less noise.
          allowed_updates: ['message'],
          drop_pending_updates: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
      } | null;

      if (!response.ok || !payload?.ok) {
        return {
          ok: false,
          detail: payload?.description ?? `Telegram returned HTTP ${response.status}.`,
        };
      }
      return { ok: true, detail: `Telegram will deliver updates to ${webhookUrl}.` };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Could not reach the Telegram API.',
      };
    }
  },
};

/** Telegram returns `parameters.retry_after` (seconds) on a 429. */
async function retryAfterFromBody(response: Response): Promise<number | undefined> {
  try {
    const payload = (await response.json()) as { parameters?: { retry_after?: number } };
    const seconds = payload.parameters?.retry_after;
    return typeof seconds === 'number' ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}
