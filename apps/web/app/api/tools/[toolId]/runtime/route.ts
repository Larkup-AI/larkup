import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { runWithProject } from '@larkup/core/project-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';
import { withGlobalVisionGatewayConfig } from '@/lib/marketplace/tool-runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RuntimeProvisioner = {
  provisionRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<{
    config: Record<string, unknown>;
    display?: Record<string, string>;
  }>;
  ensureRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<void>;
  restartRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<void>;
  installRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<void>;
  stopRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<void>;
};

function withProject<T>(request: Request, operation: () => Promise<T>) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

/** Generic bridge for a tool-declared managed runtime setup. */
export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    config?: Record<string, unknown>;
  };
  // Marketplace tools are installed once for the host application, not once
  // per project. Resolve the package before entering the project's config
  // scope; otherwise a project-specific working directory makes an installed
  // tool look missing.
  const [installed, extension] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<RuntimeProvisioner>(toolId),
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
  return withProject(request, async () => {
    const config = await readConfig();
    try {
      const actionConfig =
        body.config && typeof body.config === 'object' && !Array.isArray(body.config)
          ? body.config
          : {};
      const current = withGlobalVisionGatewayConfig(
        {
          ...installed.config,
          ...(config.toolConfigs?.[toolId] ?? {}),
          ...actionConfig,
        },
        config,
      );
      const action = body.action;
      const provisioned = extension.provisionRuntime
        ? await extension.provisionRuntime({ config: current, fetch: globalThis.fetch })
        : { config: {} };
      const runtimeConfig = { ...current, ...provisioned.config };
      if (action === 'start' && extension.ensureRuntime) {
        await extension.ensureRuntime({ config: runtimeConfig, fetch: globalThis.fetch });
      }
      if (action === 'restart') {
        if (!extension.restartRuntime) {
          return NextResponse.json(
            { error: 'This runtime cannot be restarted from Larkup.' },
            { status: 400 },
          );
        }
        await extension.restartRuntime({ config: runtimeConfig, fetch: globalThis.fetch });
      }
      if (action === 'install') {
        if (!extension.installRuntime) {
          return NextResponse.json(
            { error: 'This runtime cannot be installed from Larkup.' },
            { status: 400 },
          );
        }
        await extension.installRuntime({ config: runtimeConfig, fetch: globalThis.fetch });
      }
      if (action === 'stop') {
        if (!extension.stopRuntime) {
          return NextResponse.json(
            { error: 'This runtime cannot be stopped from Larkup.' },
            { status: 400 },
          );
        }
        await extension.stopRuntime({ config: runtimeConfig, fetch: globalThis.fetch });
      }
      await writeConfig({
        ...config,
        toolConfigs: {
          ...(config.toolConfigs ?? {}),
          [toolId]: {
            ...(config.toolConfigs?.[toolId] ?? {}),
            ...provisioned.config,
          },
        },
      });
      return NextResponse.json({
        status:
          action === 'start' || action === 'restart' || action === 'install'
            ? 'ready'
            : action === 'stop'
              ? 'stopped'
              : 'connected',
        display: provisioned.display ?? {},
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not provision this runtime.' },
        { status: 503 },
      );
    }
  });
}
