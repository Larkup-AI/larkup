import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getIntegration } from '@larkup/integrations';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function responseHtml(integration: string, status: string) {
  return new NextResponse(
    `<!doctype html><html><body><script>if(window.opener){window.opener.postMessage({type:'integration_oauth',integration:${JSON.stringify(
      integration,
    )},status:${JSON.stringify(
      status,
    )}},window.location.origin);window.close();}else{window.location.href='/add';}</script><p>Authentication complete. You can close this window.</p></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  );
}

export async function GET(request: Request, context: { params: Promise<{ integration: string }> }) {
  const integration = getIntegration((await context.params).integration);
  if (!integration) return responseHtml('unknown', 'error');
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  if (!token) return responseHtml(integration.id, searchParams.get('error') ?? 'error');
  const key = integration.oauth.accessTokenEnv;
  const envPath = resolve(process.cwd(), '.env.local');
  const line = `${key}="${token}"`;
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    writeFileSync(
      envPath,
      content.match(new RegExp(`^${key}=`, 'm'))
        ? content.replace(new RegExp(`^${key}=.*$`, 'm'), line)
        : `${content.trimEnd()}\n${line}\n`,
      'utf8',
    );
  } else appendFileSync(envPath, `${line}\n`);
  process.env[key] = token;
  return responseHtml(integration.id, 'connected');
}
