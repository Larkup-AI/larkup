import { NextResponse } from 'next/server';
import { getToolById } from '@larkup/marketplace/registry';
import {
  installTool,
  uninstallTool,
  isToolInstalled,
  getInstalledTool,
} from '@larkup/marketplace/installer';
import { unloadTool } from '@larkup/marketplace/loader';
import { readConfig, writeConfig } from '@larkup/core/config-store';
import { runWithProject } from '@larkup/core/project-store';
import { loadToolExtension } from '@larkup/marketplace/extension';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RuntimeProvisioner = {
  provisionRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<{ config: Record<string, unknown>; display?: Record<string, string> }>;
};
type RuntimeRemover = {
  removeRuntime?: (context: {
    config: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
  }) => Promise<void>;
};

function withProject<T>(request: Request, operation: () => Promise<T>) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? url.searchParams.get('serverId');
  return projectId ? runWithProject(projectId, operation) : operation();
}

/** Provision tools that opt into it immediately after installation. */
async function provisionInstalledRuntime(
  toolId: string,
  installed: Awaited<ReturnType<typeof getInstalledTool>>,
  extension: Awaited<ReturnType<typeof loadToolExtension<RuntimeProvisioner>>>,
): Promise<Record<string, string> | undefined> {
  const config = await readConfig();
  if (!installed) return undefined;

  const current = { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}) };
  const provisioned = extension?.provisionRuntime
    ? await extension.provisionRuntime({
        config: current,
        fetch: globalThis.fetch,
      })
    : { config: {} };
  const enabledTools = config.enabledTools?.length
    ? [...new Set([...config.enabledTools, toolId])]
    : config.enabledTools;
  const enabledToolsChanged =
    enabledTools?.length !== config.enabledTools?.length ||
    enabledTools?.some((id, index) => id !== config.enabledTools?.[index]);
  if (Object.keys(provisioned.config).length > 0 || enabledToolsChanged) {
    await writeConfig({
      ...config,
      enabledTools,
      toolConfigs: {
        ...(config.toolConfigs ?? {}),
        [toolId]: { ...(config.toolConfigs?.[toolId] ?? {}), ...provisioned.config },
      },
    });
  }
  return provisioned.display;
}

/** GET → get tool details. */
export async function GET(_req: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const descriptor = await getToolById(toolId);
  if (!descriptor) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  const installed = await getInstalledTool(toolId);
  return NextResponse.json({
    tool: descriptor,
    installed: installed ?? null,
  });
}

/** POST → install a tool. */
export async function POST(req: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  const descriptor = await getToolById(toolId);
  if (!descriptor) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  if (descriptor.comingSoon) {
    return NextResponse.json({ error: `${descriptor.name} is coming soon.` }, { status: 400 });
  }

  const alreadyInstalled = await isToolInstalled(toolId);
  const forceUpdate = new URL(req.url).searchParams.get('force') === 'true';

  try {
    const body = (await req.json().catch(() => ({}))) as { runtimeMode?: unknown };
    const runtimeMode =
      typeof body.runtimeMode === 'string' &&
      descriptor.runtime?.modes.some((mode) => mode.id === body.runtimeMode)
        ? body.runtimeMode
        : undefined;
    if (!alreadyInstalled || forceUpdate) {
      await installTool(toolId, undefined, runtimeMode ? { runtimeMode } : {});
      // A successful re-install may have replaced the package's ESM files.
      // Ensure the next media job imports the new module rather than a cached one.
      unloadTool(toolId);
    }
    let display: Record<string, string> | undefined;
    let provisioningWarning: string | undefined;
    try {
      const [installed, extension] = await Promise.all([
        getInstalledTool(toolId),
        loadToolExtension<RuntimeProvisioner>(toolId),
      ]);
      display = await withProject(req, () =>
        provisionInstalledRuntime(toolId, installed, extension),
      );
    } catch (error) {
      // The package is still installed if an optional managed runtime is temporarily unavailable.
      provisioningWarning =
        error instanceof Error ? error.message : 'Could not provision the tool runtime yet.';
    }
    return NextResponse.json(
      {
        status: alreadyInstalled ? (forceUpdate ? 'updated' : 'already-installed') : 'installed',
        display,
        provisioningWarning,
      },
      { status: alreadyInstalled ? 200 : 201 },
    );
  } catch (err) {
    let message = err instanceof Error ? err.message : 'Install failed.';

    // Sanitize technical NPM errors for non-technical users
    if (
      message.includes('npm install') ||
      message.includes('Command failed') ||
      message.includes('npm ERR!')
    ) {
      console.error(`[Marketplace] Tool installation failed:`, message);
      message = 'Failed to install the tool. Please check your connection or try again later.';
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE → uninstall a tool. */
export async function DELETE(req: Request, { params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  try {
    const [installed, extension] = await Promise.all([
      getInstalledTool(toolId),
      loadToolExtension<RuntimeRemover>(toolId),
    ]);
    await withProject(req, async () => {
      const config = await readConfig();
      if (!installed || !extension?.removeRuntime) return;
      await extension.removeRuntime({
        config: { ...installed.config, ...(config.toolConfigs?.[toolId] ?? {}) },
        fetch: globalThis.fetch,
      });
    });
  } catch (error) {
    console.error(`[Marketplace] Failed to execute removeRuntime for tool ${toolId}:`, error);
    // Proceed with uninstallation anyway so a broken tool doesn't become permanently stuck
  }
  await uninstallTool(toolId);
  // A managed Video Intelligence allowance is tied to an anonymous device
  // identity. Keep that identity on a normal uninstall so reinstalling on the
  // same computer renews the same principal instead of resetting its usage.
  // An explicit purge remains available for a user intentionally resetting it.
  const requestedPurge = new URL(req.url).searchParams.get('purgeConfig');
  const configPurged =
    toolId === 'video-intelligence' ? requestedPurge === 'true' : requestedPurge !== 'false';
  await withProject(req, async () => {
    const config = await readConfig();
    if (configPurged) {
      const { [toolId]: _removedConfig, ...toolConfigs } = config.toolConfigs ?? {};
      await writeConfig({
        ...config,
        toolConfigs,
        enabledTools: config.enabledTools?.filter((id) => id !== toolId),
      });
      return;
    }
    await writeConfig({
      ...config,
      enabledTools: config.enabledTools?.filter((id) => id !== toolId),
    });
  });
  return NextResponse.json({ status: 'uninstalled', configPurged });
}
