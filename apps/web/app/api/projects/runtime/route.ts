import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import {
  readServerState,
  refreshServerStatus,
  startServer,
  stopServer,
} from '@larkup/core/generator/server-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One Project Runtime controls both Knowledge and Assistant profiles. */
export async function GET() {
  return NextResponse.json({ runtime: await refreshServerStatus() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'start' | 'stop';
    apiKey?: string;
  };
  if (body.action === 'stop') return NextResponse.json({ runtime: await stopServer() });
  if (body.action !== 'start')
    return NextResponse.json({ error: 'action must be start or stop.' }, { status: 400 });
  const config = await readConfig();
  const state = await startServer(config, body.apiKey?.trim() || undefined);
  return NextResponse.json({ runtime: state }, { status: state.running ? 200 : 503 });
}
