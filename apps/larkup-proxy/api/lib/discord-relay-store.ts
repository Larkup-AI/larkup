import { createManagedRelayStore } from './managed-relay-store.js';

export type DiscordRelayRoute = { guildId: string; tunnelUrl: string };

const store = createManagedRelayStore({
  tableName: 'larkup_discord_relay_routes',
  installationColumn: 'guild_id',
});

export const createDiscordRelayInstallation = store.createInstallation;
export const activateDiscordRelay = store.activate;
export const deactivateDiscordRelay = store.deactivate;

export async function findDiscordRelay(guildId: string): Promise<DiscordRelayRoute | undefined> {
  const route = await store.find(guildId);
  return route ? { guildId: route.installationId, tunnelUrl: route.tunnelUrl } : undefined;
}
