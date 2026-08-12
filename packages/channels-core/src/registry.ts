/**
 * Channel registry.
 *
 * First-party channels are registered statically so the dashboard, the inbound
 * route, and the deployed agent bundle all agree on what exists. Marketplace
 * channels (manifest kind `channel`, plan §4.1) will register through the
 * extension loader instead — `registerChannel` is that seam.
 */

import { telegramChannel } from './adapters/telegram';
import { webhookChannel } from './adapters/webhook';
import type { ChannelAdapter } from './types';

const registry = new Map<string, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getChannel(id: string): ChannelAdapter | undefined {
  return registry.get(id);
}

/** Delivery order from plan §9: Widget, Webhook, Telegram, then the rest. */
export function listChannels(): ChannelAdapter[] {
  return [...registry.values()];
}

registerChannel(webhookChannel);
registerChannel(telegramChannel);

export { webhookChannel, telegramChannel };
