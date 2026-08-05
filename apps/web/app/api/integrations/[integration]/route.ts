import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getIntegration, getIntegrationReader } from '@larkup/integrations';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function provider(params: { integration: string }) {
  const integration = getIntegration(params.integration);
  const reader = getIntegrationReader(params.integration);
  return integration && reader ? { integration, reader } : undefined;
}

/** Lists importable resources for any registry-backed integration. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ integration: string }> },
) {
  const selected = provider(await context.params);
  if (!selected) return NextResponse.json({ error: 'Unknown integration' }, { status: 404 });
  const token = process.env[selected.integration.oauth.accessTokenEnv];
  if (!token) return NextResponse.json({ connected: false, resources: [] });
  try {
    return NextResponse.json({
      connected: true,
      resources: await selected.reader.listResources(token),
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        resources: [],
        error: error instanceof Error ? error.message : 'Unable to list resources',
      },
      { status: 502 },
    );
  }
}

/** Imports selected read-only resources into Larkup's existing document corpus. */
export async function POST(
  request: Request,
  context: { params: Promise<{ integration: string }> },
) {
  const selected = provider(await context.params);
  if (!selected) return NextResponse.json({ error: 'Unknown integration' }, { status: 404 });
  const token = process.env[selected.integration.oauth.accessTokenEnv];
  if (!token)
    return NextResponse.json(
      { error: `${selected.integration.name} is not connected` },
      { status: 400 },
    );

  const { resourceIds } = (await request.json()) as { resourceIds?: string[] };
  if (!resourceIds?.length)
    return NextResponse.json({ error: 'Select at least one resource' }, { status: 400 });

  try {
    const resources = await selected.reader.listResources(token);
    const requestedResources = resources.filter((resource) => resourceIds.includes(resource.id));
    const results = await Promise.all(
      requestedResources.map(async (resource) => {
        try {
          const document = await selected.reader.getResource(token, resource);
          const response = await fetch(new URL('/api/documents', request.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: document.title,
              content: document.content,
              source: 'integrations',
              url: document.url,
              metadata: {
                integrationId: selected.integration.id,
                resourceId: document.id,
                importedFrom: selected.integration.name,
              },
            }),
          });
          if (!response.ok)
            throw new Error(
              (await response.json().catch(() => ({ error: 'Import failed' }))).error,
            );
          return { id: resource.id, title: resource.title, status: 'success' as const };
        } catch (error) {
          return {
            id: resource.id,
            title: resource.title,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : 'Import failed',
          };
        }
      }),
    );
    return NextResponse.json({
      imported: results.filter((result) => result.status === 'success').length,
      total: requestedResources.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to import resources' },
      { status: 502 },
    );
  }
}

/** Removes the local development token. Production apps should replace this with their secret store. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ integration: string }> },
) {
  const selected = provider(await context.params);
  if (!selected) return NextResponse.json({ error: 'Unknown integration' }, { status: 404 });
  const key = selected.integration.oauth.accessTokenEnv;
  const envPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envPath))
    writeFileSync(
      envPath,
      readFileSync(envPath, 'utf8').replace(new RegExp(`^${key}=.*\\n?`, 'm'), ''),
      'utf8',
    );
  delete process.env[key];
  return NextResponse.json({ success: true });
}
