/** Discord Interactions API adapter. */

import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type {
  ChannelAdapter,
  DeliveryResult,
  InboundRequest,
  NormalizedMessage,
  OutboundMessage,
  VerificationResult,
} from '../types';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_MESSAGE_LENGTH = 2_000;

interface DiscordInteraction {
  id?: string;
  application_id?: string;
  type?: number;
  channel_id?: string;
  guild_id?: string;
  token?: string;
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  data?: { name?: string; options?: Array<{ name?: string; value?: string | number | boolean }> };
}

interface DiscordUser {
  id?: string;
  username?: string;
  global_name?: string;
  bot?: boolean;
}

function interactionUser(interaction: DiscordInteraction) {
  return interaction.member?.user ?? interaction.user;
}

function interactionText(interaction: DiscordInteraction): string {
  const command = interaction.data?.name?.trim() ?? '';
  const values = (interaction.data?.options ?? [])
    .map((option) => (typeof option.value === 'string' ? option.value.trim() : ''))
    .filter(Boolean);
  return [command, ...values].filter(Boolean).join(' ');
}

export function discordPingResponse(body: unknown): { type: 1 } | null {
  const interaction = body as DiscordInteraction | undefined;
  return interaction?.type === 1 ? { type: 1 } : null;
}

export const discordChannel: ChannelAdapter = {
  id: 'discord',
  name: 'Discord',
  description: 'Answer slash commands sent to your Discord application.',
  icon: '/icons/discord.png',
  testHint: 'In the Discord server you selected, run /ask followed by your message.',
  connectionUi: {
    credentialsDescription:
      'Use this only for your own Discord application. The managed option is the quickest setup.',
    requiresPublicIngress: true,
    endpointHint:
      'Discord sends interactions to Larkup’s public webhook URL. Start a public tunnel when this Agent runs locally.',
  },
  supportsStreaming: false,

  configFields: [
    {
      key: 'publicKey',
      label: 'Application public key',
      type: 'secret',
      required: true,
      placeholder: 'Discord Developer Portal → General Information',
      help: 'Discord uses this key to verify each signed interaction. Set this channel’s webhook URL as the Interactions Endpoint URL.',
      helpUrl: 'https://discord.com/developers/applications',
    },
    {
      key: 'guildId',
      label: 'Server id',
      type: 'text',
      required: false,
      hidden: true,
    },
    {
      key: 'relaySecret',
      label: 'Relay secret',
      type: 'secret',
      required: false,
      hidden: true,
    },
    {
      key: 'applicationId',
      label: 'Application id',
      type: 'text',
      required: false,
      hidden: true,
    },
  ],

  oauthConnect: {
    label: 'Connect with Discord',
    description: 'Add Larkup’s Discord app to one server.',
    completionHint: 'The selected server is securely linked to this Agent.',
    callbackFields: {
      guild_id: 'guildId',
      relay_secret: 'relaySecret',
      application_id: 'applicationId',
      public_key: 'publicKey',
    },
  },

  managedConnection: {
    sharedSecretField: 'publicKey',
    signatureHeaders: ['x-signature-timestamp', 'x-signature-ed25519'],
    relay: { workspaceIdField: 'guildId', relaySecretField: 'relaySecret' },
  },

  verify(request: InboundRequest, settings): VerificationResult {
    const publicKey = settings.publicKey?.trim();
    const timestamp = request.headers['x-signature-timestamp'];
    const signature = request.headers['x-signature-ed25519'];
    if (!publicKey) {
      return {
        ok: false,
        status: 403,
        reason: 'Channel is not configured with an application public key.',
      };
    }
    if (!timestamp || !signature) {
      return { ok: false, status: 401, reason: 'Missing Discord signature headers.' };
    }
    if (!/^[0-9a-f]{64}$/i.test(publicKey) || !/^[0-9a-f]{128}$/i.test(signature.trim())) {
      return { ok: false, status: 401, reason: 'Discord public key or signature is invalid.' };
    }

    try {
      const key = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
        format: 'der',
        type: 'spki',
      });
      const valid = verifySignature(
        null,
        Buffer.from(`${timestamp}${request.rawBody}`),
        key,
        Buffer.from(signature.trim(), 'hex'),
      );
      return valid
        ? { ok: true }
        : { ok: false, status: 401, reason: 'Discord signature does not match.' };
    } catch {
      return { ok: false, status: 401, reason: 'Discord signature could not be verified.' };
    }
  },

  interceptInbound(request) {
    const response = discordPingResponse(request.body);
    if (response) return { body: response };
    const interaction = request.body as DiscordInteraction | undefined;
    // Defer commands while the agent produces its response.
    return interaction?.type === 2 ? { body: { type: 5 }, dispatch: true } : null;
  },

  parse(request: InboundRequest): NormalizedMessage | null {
    const interaction = (request.body ?? {}) as DiscordInteraction;
    if (interaction.type !== 2 || !interaction.id) return null;
    const user = interactionUser(interaction);
    if (!user?.id || user.bot) return null;
    const text = interactionText(interaction);
    if (!text) return null;

    return {
      externalMessageId: interaction.id,
      conversationId: interaction.channel_id ?? interaction.guild_id ?? interaction.id,
      endUserId: user.id,
      endUserName: user.global_name ?? user.username,
      text,
      replyContext: {
        interactionId: interaction.id,
        applicationId: interaction.application_id ?? '',
        interactionToken: interaction.token ?? '',
      },
    };
  },

  async send(message: OutboundMessage, _settings): Promise<DeliveryResult> {
    const applicationId = String(message.replyContext.applicationId ?? '').trim();
    const interactionToken = String(message.replyContext.interactionToken ?? '').trim();
    if (!applicationId || !interactionToken) {
      return {
        ok: false,
        retryable: false,
        error: 'Discord interaction data is missing. Send a new slash command.',
      };
    }
    try {
      const response = await fetch(
        `https://discord.com/api/v10/webhooks/${encodeURIComponent(
          applicationId,
        )}/${encodeURIComponent(interactionToken)}/messages/@original`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message.text.slice(0, MAX_MESSAGE_LENGTH) }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (response.ok) return { ok: true };
      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 429,
        error: `Discord could not deliver the reply (HTTP ${response.status}).`,
      };
    } catch {
      return { ok: false, retryable: true, error: 'Discord could not be reached.' };
    }
  },

  async health(settings) {
    if (!/^[0-9a-f]{64}$/i.test(settings.publicKey?.trim() ?? '')) {
      return { status: 'misconfigured', detail: 'Enter the application public key from Discord.' };
    }
    const guildId = settings.guildId?.trim();
    if (guildId && settings.relaySecret?.trim()) {
      const testUrl = /^\d{17,20}$/.test(guildId)
        ? `https://discord.com/channels/${guildId}`
        : undefined;
      return {
        status: 'ok',
        detail: 'Discord is securely connected through Larkup Proxy.',
        ...(testUrl ? { testUrl, testUrlLabel: 'Open Discord server' } : {}),
      };
    }
    return {
      status: 'ok',
      detail: 'Public key is ready. Set the shown webhook URL in your Discord app.',
    };
  },
};

export function discordInteractionResponse(text: string): { type: 4; data: { content: string } } {
  return { type: 4, data: { content: text.slice(0, MAX_MESSAGE_LENGTH) } };
}
