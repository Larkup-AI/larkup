import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { runWithProject } from '@larkup/core/project-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UsageClient = { getUsage?: () => Promise<unknown> };

function withProject<T>(request: Request, operation: () => Promise<T>) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

export async function GET(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const requestedRuntimeMode = new URL(request.url).searchParams.get('runtimeMode');
  const [installed, extension] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<UsageClient>(toolId),
  ]);
  if (!installed) {
    return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  }
  if (!extension?.createClient) {
    return NextResponse.json(
      { error: 'Installed tool could not be loaded. Restart Larkup or reinstall the tool.' },
      { status: 503 },
    );
  }
  return withProject(request, async () => {
    const config = await readConfig();

    const client = extension.createClient({
      config: {
        ...installed.config,
        ...(config.toolConfigs?.[toolId] ?? {}),
        ...(requestedRuntimeMode ? { runtimeMode: requestedRuntimeMode } : {}),
      },
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
  });
}
