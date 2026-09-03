import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getChannel,
  listChannelSummaries,
  listConnectionSummaries,
  validateChannelSettings,
} from '@larkup/connections';
import { getProjectDataDir, requireProjectDataDir } from '@larkup/core/project-store';
import {
  registerManagedChannelRelay,
  withManagedConnectionHealthSettings,
} from '@/lib/connections/managed-channel';
import { getLocalTunnelStatus, localWebPort } from '@/lib/connections/ngrok';

type Target = {
  mode: 'local' | 'remote';
  endpoint: string;
  apiKey?: string;
};
type ProviderMetadata = {
  identity?: string;
  externalId?: string;
  testUrl?: string;
  testUrlLabel?: string;
};
type StoredConnection = {
  id: string;
  enabled: boolean;
  managed?: boolean;
  settings: Record<string, string>;
  target: Target;
  provider?: ProviderMetadata;
  updatedAt: string;
};

const MASKED_SECRET = '••••••••';

async function file(create: boolean) {
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
  return dir ? path.join(dir, 'connections.json') : null;
}
async function read() {
  const target = await file(false);
  if (!target) return [] as StoredConnection[];
  try {
    const value = JSON.parse(await fs.readFile(target, 'utf8'));
    return Array.isArray(value) ? (value as StoredConnection[]) : [];
  } catch {
    return [];
  }
}
function publicConnection(connection: StoredConnection) {
  const adapter = getChannel(connection.id);
  const secrets = new Set(
    adapter?.configFields.filter((field) => field.type === 'secret').map((field) => field.key),
  );
  return {
    ...connection,
    target: { ...connection.target, apiKey: connection.target.apiKey ? '••••••••' : undefined },
    settings: Object.fromEntries(
      Object.entries(connection.settings).map(([key, value]) => [
        key,
        secrets.has(key) && value ? '••••••••' : value,
      ]),
    ),
  };
}

function mergeSettings(
  adapter: NonNullable<ReturnType<typeof getChannel>>,
  current: StoredConnection | undefined,
  submitted: Record<string, string> | undefined,
) {
  const settings = { ...(current?.settings ?? {}), ...(submitted ?? {}) };
  for (const field of adapter.configFields) {
    if (field.type !== 'secret') continue;
    const value = submitted?.[field.key];
    if ((value === MASKED_SECRET || value === '') && current?.settings[field.key]) {
      settings[field.key] = current.settings[field.key];
    }
  }
  return settings;
}

export async function GET() {
  const connections = await read();
  return NextResponse.json({
    connectionsCatalog: listConnectionSummaries(),
    channels: listChannelSummaries(),
    connections: connections.map(publicConnection),
  });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<StoredConnection> | null;
  if (!body?.id || !body.target?.endpoint)
    return NextResponse.json({ error: 'A channel target endpoint is required.' }, { status: 400 });
  const adapter = getChannel(body.id);
  if (!adapter) return NextResponse.json({ error: 'Unsupported channel.' }, { status: 400 });
  const current = (await read()).find((connection) => connection.id === body.id);
  const settings = mergeSettings(adapter, current, body.settings);
  const managed = Boolean(adapter.managedConnection && body.managed === true);
  const effectiveSettings = managed
    ? withManagedConnectionHealthSettings(adapter.managedConnection, settings, true)
    : settings;
  const validation = validateChannelSettings(adapter, effectiveSettings);
  if (!validation.ok)
    return NextResponse.json(
      { error: 'Missing or invalid channel settings.', fieldErrors: validation.errors },
      { status: 422 },
    );
  const connection: StoredConnection = {
    id: adapter.id,
    enabled: body.enabled !== false,
    managed,
    settings,
    target: {
      mode: body.target.mode === 'remote' ? 'remote' : 'local',
      endpoint: body.target.endpoint.replace(/\/$/, ''),
      apiKey: body.target.apiKey === MASKED_SECRET ? current?.target.apiKey : body.target.apiKey,
    },
    provider: current?.provider,
    updatedAt: new Date().toISOString(),
  };

  const tunnel = await getLocalTunnelStatus(localWebPort(request));
  if (
    connection.enabled &&
    adapter.connectionUi?.requiresPublicIngress &&
    tunnel.status !== 'running'
  ) {
    return NextResponse.json(
      { error: 'Start the public HTTPS tunnel before saving this channel.' },
      { status: 422 },
    );
  }
  const inboundBaseUrl = tunnel.publicUrl ?? new URL(request.url).origin;
  const webhookUrl = new URL(`/api/connections/${adapter.id}`, inboundBaseUrl).toString();
  const relayRegistration = managed
    ? await registerManagedChannelRelay(
        adapter.id,
        adapter.managedConnection,
        connection.settings,
        tunnel.publicUrl,
      )
    : undefined;
  if (relayRegistration && !relayRegistration.ok) {
    return NextResponse.json({ error: relayRegistration.detail }, { status: 502 });
  }

  const webhookRegistration =
    connection.enabled && adapter.registerWebhook
      ? await adapter.registerWebhook(webhookUrl, settings)
      : undefined;
  if (webhookRegistration && !webhookRegistration.ok) {
    return NextResponse.json(
      { error: `Could not register the ${adapter.name} webhook: ${webhookRegistration.detail}` },
      { status: 502 },
    );
  }

  const providerRegistration = relayRegistration ?? webhookRegistration;
  if (providerRegistration?.ok) {
    const health = await adapter.health(effectiveSettings);
    if (health.status === 'ok') {
      connection.provider = {
        ...(health.identity ? { identity: health.identity } : {}),
        ...(health.externalId ? { externalId: health.externalId } : {}),
        ...(health.testUrl ? { testUrl: health.testUrl } : {}),
        ...(health.testUrlLabel ? { testUrlLabel: health.testUrlLabel } : {}),
      };
    }
  }

  const all = (await read()).filter((item) => item.id !== connection.id);
  all.push(connection);
  const target = await file(true);
  if (!target) return NextResponse.json({ error: 'No active Project.' }, { status: 400 });
  await fs.writeFile(target, JSON.stringify(all, null, 2), 'utf8');

  return NextResponse.json({
    connection: publicConnection(connection),
    webhookUrl,
    webhookRegistration: providerRegistration,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    managed?: boolean;
    settings?: Record<string, string>;
    target?: Partial<Target>;
  };
  const adapter = body.id ? getChannel(body.id) : undefined;
  if (!body.id || !adapter)
    return NextResponse.json({ error: 'Unsupported channel.' }, { status: 400 });
  const current = (await read()).find((item) => item.id === body.id);
  const settings = mergeSettings(adapter, current, body.settings);
  const managed = Boolean(
    adapter.managedConnection && (body.managed === true || current?.managed === true),
  );
  const effectiveSettings = managed
    ? withManagedConnectionHealthSettings(adapter.managedConnection, settings, true)
    : settings;
  const endpoint = (body.target?.endpoint || current?.target.endpoint || '').replace(/\/$/, '');
  if (!endpoint)
    return NextResponse.json(
      { error: 'An Agent endpoint is required to test this channel.' },
      { status: 400 },
    );
  const apiKey =
    body.target?.apiKey === MASKED_SECRET
      ? current?.target.apiKey
      : body.target?.apiKey || current?.target.apiKey;
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const [channel, runtime] = await Promise.all([
    adapter.health(effectiveSettings),
    fetch(`${endpoint}/agent`, { headers, signal: AbortSignal.timeout(8_000) })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
  ]);
  return NextResponse.json({
    channel,
    runtime: runtime ? { ok: runtime.profile === 'agent', name: runtime.name } : { ok: false },
  });
}
