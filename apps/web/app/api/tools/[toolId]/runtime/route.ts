import { NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { loadToolExtension } from '@larkup/marketplace/extension';
import { getInstalledTool } from '@larkup/marketplace/installer';

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
};

/** Generic bridge for a tool-declared managed runtime setup. */
export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const [installed, extension, config] = await Promise.all([
    getInstalledTool(toolId),
    loadToolExtension<RuntimeProvisioner>(toolId),
    readConfig(),
  ]);
  if (!installed || !extension) {
    return NextResponse.json({ error: 'Tool is not installed.' }, { status: 404 });
  }
  try {
    const current = { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}) };
    const action = ((await request.json().catch(() => ({}))) as { action?: string }).action;
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
    await writeConfig({
      ...config,
      toolConfigs: {
        ...(config.toolConfigs ?? {}),
        [toolId]: { ...(config.toolConfigs?.[toolId] ?? {}), ...provisioned.config },
      },
    });
    return NextResponse.json({
      status: action === 'start' || action === 'restart' ? 'ready' : 'connected',
      display: provisioned.display ?? {},
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not provision this runtime.' },
      { status: 503 },
    );
  }
}
