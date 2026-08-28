import { createManagedRelayStore } from './managed-relay-store.js';

export type SlackRelayRoute = { teamId: string; tunnelUrl: string };

const store = createManagedRelayStore({
  tableName: 'larkup_slack_relay_routes',
  installationColumn: 'team_id',
});

export const initializeSlackRelayStore = store.ensureSchema;
export const createSlackRelayInstallation = store.createInstallation;
export const activateSlackRelay = store.activate;
export const deactivateSlackRelay = store.deactivate;

export async function findSlackRelay(teamId: string): Promise<SlackRelayRoute | undefined> {
  const route = await store.find(teamId);
  return route ? { teamId: route.installationId, tunnelUrl: route.tunnelUrl } : undefined;
}
