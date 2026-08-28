import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UsageClient = { getUsage?: () => Promise<unknown> };

export async function GET(_request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const [installed, extension, config] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<UsageClient>(toolId),
    readConfig(),
  ]);
  if (!installed || !extension?.createClient) {
    return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  }

  const client = extension.createClient({
    config: { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}) },
    fetch: globalThis.fetch,
  });
  if (typeof client.getUsage !== 'function') {
    return NextResponse.json({ error: 'This tool does not expose usage.' }, { status: 404 });
  }

  try {
    return NextResponse.json(await client.getUsage());
  } catch {
    return NextResponse.json(
      { error: 'Usage is unavailable for the selected runtime.' },
      { status: 503 },
    );
  }
}
