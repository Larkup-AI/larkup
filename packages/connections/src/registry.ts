/** Registry for built-in and extension-provided channels. */

import { discordChannel } from './adapters/discord';
import { slackChannel } from './adapters/slack';
import { telegramChannel } from './adapters/telegram';
import { webhookChannel } from './adapters/webhook';
import type { ChannelAdapter, ChannelConfigField } from './types';

const registry = new Map<string, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getChannel(id: string): ChannelAdapter | undefined {
  return registry.get(id);
}

/** Registered channel adapters. */
export function listChannels(): ChannelAdapter[] {
  return [...registry.values()];
}

/** Adapter data safe to expose to the dashboard. */
export interface ChannelSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  configFields: ChannelConfigField[];
  testHint?: string;
  setupInstructions?: string[];
  oauthConnect?: {
    label: string;
    startUrl: string;
    description?: string;
    completionHint?: string;
  };
  connectionUi?: {
    credentialsDescription?: string;
    endpointHint?: string;
    requiresPublicIngress?: boolean;
    publicIngressDescription?: string;
    contact?: {
      mention?: string;
      directMessage: string;
      channelMessage?: string;
    };
  };
  managedConnection?: {
    sharedSecretField?: string;
    relay?: {
      workspaceIdField: string;
      relaySecretField: string;
    };
  };
  supportsStreaming: boolean;
  /** True when saving can tell the provider where to send updates automatically (see `registerWebhook`). */
  supportsWebhookRegistration: boolean;
  /** An optional place to take the operator after setup to send a real message. */
  testUrl?: string;
}

/** A catalog provider without a runtime adapter yet. */
export interface ComingSoonConnectionSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  availability: 'coming_soon';
}

/** Connection catalog entry for the dashboard. */
export type ConnectionSummary =
  | (ChannelSummary & { availability: 'available' })
  | ComingSoonConnectionSummary;

const comingSoonConnections: ComingSoonConnectionSummary[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Answer customer messages through WhatsApp Business.',
    icon: '/icons/whatsapp.png',
    availability: 'coming_soon',
  },
  {
    id: 'messenger',
    name: 'Messenger',
    description: 'Connect your Facebook Messenger inbox.',
    icon: '/icons/messenger.svg',
    availability: 'coming_soon',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Reply to conversations from your Instagram inbox.',
    icon: '/icons/Instagram.png',
    availability: 'coming_soon',
  },
  {
    id: 'email',
    name: 'Email',
    description: 'Turn your shared support inbox into an Agent connection.',
    icon: '/icons/email.png',
    availability: 'coming_soon',
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Assist support tickets and agent replies in Zendesk.',
    icon: '/icons/zendesk.png',
    availability: 'coming_soon',
  },
  {
    id: 'phone',
    name: 'Phone',
    description: 'Bring voice conversations to your Agent.',
    icon: '/icons/phone.png',
    availability: 'coming_soon',
  },
];

/** Dashboard-safe summaries of registered channels. */
export function listChannelSummaries(): ChannelSummary[] {
  return listChannels().map((channel) => ({
    id: channel.id,
    name: channel.name,
    description: channel.description,
    icon: channel.icon,
    configFields: channel.configFields,
    testHint: channel.testHint,
    setupInstructions: channel.setupInstructions,
    oauthConnect: channel.oauthConnect && {
      label: channel.oauthConnect.label,
      startUrl: `/api/connections/${channel.id}/oauth/start`,
      description: channel.oauthConnect.description,
      completionHint: channel.oauthConnect.completionHint,
    },
    connectionUi: channel.connectionUi,
    managedConnection: channel.managedConnection && {
      sharedSecretField: channel.managedConnection.sharedSecretField,
      relay: channel.managedConnection.relay,
    },
    supportsStreaming: channel.supportsStreaming,
    supportsWebhookRegistration: Boolean(channel.registerWebhook),
    testUrl: channel.testUrl,
  }));
}

/** Complete connection catalog for provider cards. */
export function listConnectionSummaries(): ConnectionSummary[] {
  return [
    ...listChannelSummaries().map((channel) => ({
      ...channel,
      availability: 'available' as const,
    })),
    ...comingSoonConnections,
  ];
}

registerChannel(webhookChannel);
registerChannel(telegramChannel);
registerChannel(slackChannel);
registerChannel(discordChannel);

export { webhookChannel, telegramChannel, slackChannel, discordChannel };
