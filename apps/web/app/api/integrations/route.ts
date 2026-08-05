import { NextResponse } from 'next/server';
import { readyIntegrations } from '@larkup/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Returns connection state without exposing any integration token. */
export async function GET() {
  return NextResponse.json({
    integrations: readyIntegrations.map((integration) => ({
      id: integration.id,
      connected: Boolean(process.env[integration.oauth.accessTokenEnv]),
    })),
  });
}
