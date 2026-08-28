import { NextResponse } from 'next/server';
import {
  getLocalTunnelStatus,
  localWebPort,
  startLocalTunnel,
  stopLocalTunnel,
} from '@/lib/connections/ngrok';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reports the public HTTPS ingress available to the active local Project. */
export async function GET(request: Request) {
  return NextResponse.json(await getLocalTunnelStatus(localWebPort(request)));
}

/** Starts or stops the active Project's local ngrok tunnel. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: 'start' | 'stop';
    authtoken?: string;
  };
  const port = localWebPort(request);
  if (body.action === 'stop') return NextResponse.json(await stopLocalTunnel(port));
  if (body.action !== 'start')
    return NextResponse.json({ error: 'action must be start or stop.' }, { status: 400 });
  if (body.authtoken && body.authtoken.length > 512)
    return NextResponse.json({ error: 'Invalid ngrok authtoken.' }, { status: 400 });
  const tunnel = await startLocalTunnel(port, body.authtoken);
  return NextResponse.json(tunnel, { status: tunnel.status === 'unavailable' ? 422 : 200 });
}
