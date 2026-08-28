import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HealthClient = { health?: () => Promise<unknown> };

export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const override = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const [installed, extension, config] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<HealthClient>(toolId),
    readConfig(),
  ]);
  if (!installed || !extension?.createClient) {
    return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  }
  try {
    const client = extension.createClient({
      config: { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}), ...override },
      fetch: globalThis.fetch,
    });
    if (typeof client.health !== 'function') {
      return NextResponse.json(
        { error: 'This tool does not expose health checks.' },
        { status: 404 },
      );
    }
    await client.health();
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json(
      { error: 'Could not connect. Check the selected runtime and access key.' },
      { status: 400 },
    );
  }
}
