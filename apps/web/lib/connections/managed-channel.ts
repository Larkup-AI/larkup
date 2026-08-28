export const MANAGED_CHANNELS_PROXY_URL = 'https://larkup-proxy.larkup.de/api/channels';
const MANAGED_CONNECTION_HEALTH_SECRET = 'managed-by-larkup-proxy';

type ManagedConnection =
  | {
      sharedSecretField?: string;
      relay?: { workspaceIdField: string; relaySecretField: string };
    }
  | undefined;

export type ManagedRelayRegistration = { ok: boolean; detail: string };

export function managedChannelsProxyUrl(): string {
  return process.env.NEXT_PUBLIC_CHANNELS_PROXY_URL?.trim() || MANAGED_CHANNELS_PROXY_URL;
}

export function withManagedConnectionHealthSettings(
  managedConnection: ManagedConnection,
  settings: Record<string, string>,
  managed: boolean,
): Record<string, string> {
  const sharedSecretField = managedConnection?.sharedSecretField;
  if (!managed || !sharedSecretField || settings[sharedSecretField]?.trim()) return settings;
  return { ...settings, [sharedSecretField]: MANAGED_CONNECTION_HEALTH_SECRET };
}

export async function verifyManagedChannelEvent(
  channelId: string,
  signatureHeaders: string[] | undefined,
  request: Pick<Request, 'headers'>,
  rawBody: string,
): Promise<boolean> {
  try {
    const proxyUrl = managedChannelsProxyUrl();
    const response = await fetch(
      new URL(`${encodeURIComponent(channelId)}/verify`, `${proxyUrl.replace(/\/$/, '')}/`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...Object.fromEntries(
            (signatureHeaders ?? []).flatMap((name) => {
              const value = request.headers.get(name);
              return value ? [[name, value]] : [];
            }),
          ),
        },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      },
    );
    return response.ok && (await response.json().catch(() => ({ valid: false }))).valid === true;
  } catch {
    return false;
  }
}

/**
 * Registers this local public tunnel with the managed provider relay. The
 * OAuth callback supplies a one-time, per-workspace secret; the proxy stores
 * only its hash, while the user keeps the actual value locally.
 */
export async function registerManagedChannelRelay(
  channelId: string,
  managedConnection: ManagedConnection,
  settings: Record<string, string>,
  tunnelUrl: string | undefined,
): Promise<ManagedRelayRegistration | undefined> {
  const relay = managedConnection?.relay;
  if (!relay) return undefined;
  const workspaceId = settings[relay.workspaceIdField]?.trim();
  const relaySecret = settings[relay.relaySecretField]?.trim();
  if (!workspaceId || !relaySecret)
    return { ok: false, detail: 'Reconnect this managed channel to activate the secure relay.' };
  if (!tunnelUrl)
    return { ok: false, detail: 'Start the public HTTPS tunnel before connecting this channel.' };

  try {
    const proxyUrl = managedChannelsProxyUrl();
    const response = await fetch(
      new URL(`${encodeURIComponent(channelId)}/relay/register`, `${proxyUrl.replace(/\/$/, '')}/`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${relaySecret}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId, tunnel_url: tunnelUrl }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    return response.ok
      ? { ok: true, detail: 'Larkup Proxy is securely connected to this installation.' }
      : {
          ok: false,
          detail: 'Larkup Proxy could not activate this channel. Reconnect and try again.',
        };
  } catch {
    return { ok: false, detail: 'Larkup Proxy could not be reached. Try again in a moment.' };
  }
}

/** Best-effort cleanup of a relay route before local credentials are removed. */
export async function disconnectManagedChannelRelay(
  channelId: string,
  managedConnection: ManagedConnection,
  settings: Record<string, string>,
): Promise<void> {
  const relay = managedConnection?.relay;
  const workspaceId = relay && settings[relay.workspaceIdField]?.trim();
  const relaySecret = relay && settings[relay.relaySecretField]?.trim();
  if (!relay || !workspaceId || !relaySecret) return;
  try {
    const proxyUrl = managedChannelsProxyUrl();
    await fetch(
      new URL(
        `${encodeURIComponent(channelId)}/relay/disconnect`,
        `${proxyUrl.replace(/\/$/, '')}/`,
      ),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${relaySecret}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    // Local disconnect must still remove local credentials if the network is down.
  }
}
