import { NextResponse } from 'next/server';
import { readConfig } from '@larkup/core/config-store';
import { runWithProject } from '@larkup/core/project-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { withGlobalVisionGatewayConfig } from '@/lib/marketplace/tool-runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HostCapabilitiesProvider = {
  getHostCapabilities?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<Record<string, unknown>>;
};

function withProject<T>(request: Request, operation: () => Promise<T>) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

/** Generic bridge for a tool-declared host/environment report (used before a local install). */
export async function GET(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  // Tool packages live at the application level while config lives at the
  // project level. Do not resolve the package after entering project scope.
  const [installed, extension] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<HostCapabilitiesProvider>(toolId),
  ]);
  if (!installed) {
    return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  }
  if (!extension) {
    return NextResponse.json(
      { error: 'Installed tool could not be loaded. Restart Larkup or reinstall the tool.' },
      { status: 503 },
    );
  }
  const getHostCapabilities = extension.getHostCapabilities;
  if (!getHostCapabilities) {
    return NextResponse.json(
      { error: 'This tool does not report host capabilities.' },
      { status: 400 },
    );
  }
  return withProject(request, async () => {
    const config = await readConfig();
    try {
      const current = withGlobalVisionGatewayConfig(
        { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}) },
        config,
      );
      const report = await getHostCapabilities({ config: current, fetch: globalThis.fetch });
      return NextResponse.json(report);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not detect host capabilities.' },
        { status: 503 },
      );
    }
  });
}
