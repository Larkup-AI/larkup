import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { runWithProject } from '@larkup/core/project-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { withGlobalVisionGatewayConfig } from '@/lib/marketplace/tool-runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VerifiableTool = {
  verifyConfiguration?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
    verifyKey?: string;
  }) => Promise<void>;
};

function withProject<T>(request: Request, operation: () => Promise<T>) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

/** Generic bridge for a tool-declared configuration check. */
export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    config?: Record<string, unknown>;
    verifyKey?: string;
  };
  const [installed, extension] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<VerifiableTool>(toolId),
  ]);
  if (!installed) return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  const verifyConfiguration = extension?.verifyConfiguration;
  if (!verifyConfiguration) {
    return NextResponse.json(
      { error: 'This tool does not support verification.' },
      { status: 400 },
    );
  }
  return withProject(request, async () => {
    const config = await readConfig();
    const submitted =
      body.config && typeof body.config === 'object' && !Array.isArray(body.config)
        ? body.config
        : {};
    try {
      await verifyConfiguration({
        config: withGlobalVisionGatewayConfig(
          { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}), ...submitted },
          config,
        ),
        fetch: globalThis.fetch,
        verifyKey: body.verifyKey,
      });
      return NextResponse.json({ status: 'verified' });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Verification failed.' },
        { status: 400 },
      );
    }
  });
}
