import { after, NextResponse } from 'next/server';
import { dispatchInbound, getChannel } from '@larkup/connections';
import { readSession, appendToSession } from '@larkup/core/session-store';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getProjectDataDir, requireProjectDataDir } from '@larkup/core/project-store';
import {
  disconnectManagedChannelRelay,
  verifyManagedChannelEvent,
} from '@/lib/connections/managed-channel';

async function connection(id: string) {
  const dir = await getProjectDataDir();
  if (!dir) return null;
  try {
    return (
      JSON.parse(await fs.readFile(path.join(dir, 'connections.json'), 'utf8')) as Array<any>
    ).find((item) => item.id === id && item.enabled);
  } catch {
    return null;
  }
}
async function agentText(
  endpoint: string,
  apiKey: string | undefined,
  messages: Array<{ role: string; content: string }>,
) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => ({}))).error || `Agent returned HTTP ${response.status}.`,
    );
  const body = await response.text();
  let answer = '';
  for (const line of body.split(/\r?\n/)) {
    try {
      if (line.startsWith('0:')) {
        const value = JSON.parse(line.slice(2));
        if (typeof value === 'string') answer += value;
      } else if (line.startsWith('data:')) {
        const value = JSON.parse(line.slice(5));
        if (value?.type === 'text-delta') answer += value.delta || value.text || '';
      }
    } catch {}
  }
  return answer;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const stored = await connection(channelId);
  const adapter = getChannel(channelId);
  if (!stored || !adapter)
    return NextResponse.json({ error: 'Channel is not configured.' }, { status: 404 });
  const rawBody = await request.text();
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : undefined;
  } catch {
    body = undefined;
  }
  const settings = stored.settings;
  const inboundRequest = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    rawBody,
    body,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
  };

  const managedConnection = Boolean(adapter.managedConnection && stored.managed === true);
  if (
    managedConnection &&
    !(await verifyManagedChannelEvent(
      channelId,
      adapter.managedConnection?.signatureHeaders,
      request,
      rawBody,
    ))
  ) {
    return NextResponse.json(
      { error: 'Managed channel event verification failed.' },
      { status: 401 },
    );
  }
  const dispatchAdapter = managedConnection
    ? { ...adapter, verify: () => ({ ok: true as const }) }
    : adapter;

  const runDispatch = () =>
    dispatchInbound({
      adapter: dispatchAdapter,
      agentId: stored.target.endpoint,
      settings,
      request: inboundRequest,
      runAgent: async ({ sessionId, message }) => {
        const history = await readSession(sessionId);
        const text = await agentText(stored.target.endpoint, stored.target.apiKey, [
          ...history,
          { role: 'user', content: message },
        ]);
        await appendToSession(sessionId, message, text);
        return { text };
      },
    });
  const interception = dispatchAdapter.interceptInbound?.(inboundRequest);
  if (interception) {
    const verification = dispatchAdapter.verify(inboundRequest, settings);
    if (!verification.ok)
      return NextResponse.json({ error: verification.reason }, { status: verification.status });
    if (interception.dispatch) {
      // Respond before longer Agent work.
      after(async () => {
        try {
          await runDispatch();
        } catch (error) {
          console.error('[connections] deferred inbound dispatch failed', error);
        }
      });
    }
    return NextResponse.json(interception.body, { status: interception.status ?? 200 });
  }

  const result = await runDispatch();
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const dir = await requireProjectDataDir();
  const target = path.join(dir, 'connections.json');
  try {
    const connections = JSON.parse(await fs.readFile(target, 'utf8')) as Array<{
      id?: string;
      managed?: boolean;
      settings?: Record<string, string>;
    }>;
    const existing = connections.find((item) => item.id === channelId);
    const adapter = getChannel(channelId);
    if (existing?.managed && adapter?.managedConnection && existing.settings) {
      await disconnectManagedChannelRelay(channelId, adapter.managedConnection, existing.settings);
    }
    const remaining = connections.filter((item) => item.id !== channelId);
    if (remaining.length === connections.length) {
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 });
    }
    await fs.writeFile(target, JSON.stringify(remaining, null, 2), 'utf8');
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: 'Connection not found.' }, { status: 404 });
  }
}
