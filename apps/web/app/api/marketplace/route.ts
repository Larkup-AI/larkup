import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAllTools } from '@larkup/marketplace/registry';
import {
  getInstalledTools,
  getDownloadCounts,
  getOngoingOperations,
  resolveWorkspaceToolPath,
} from '@larkup/marketplace/installer';
import type { InstalledTool, ToolDescriptor, ToolStatus } from '@larkup/marketplace/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Installed packages are the source of truth for their settings. The Hub
 * catalog can lag behind a tool release, so resolve its bundled manifest here. */
async function readInstalledDescriptor(tool: InstalledTool): Promise<ToolDescriptor | null> {
  const workspacePath =
    tool.source === 'local' ? await resolveWorkspaceToolPath(tool.packageName) : undefined;
  const candidates = [tool.resolvedPath, workspacePath].filter((candidate): candidate is string =>
    Boolean(candidate),
  );
  for (const start of candidates) {
    let directory = start;
    for (let depth = 0; depth < 3; depth += 1) {
      try {
        const raw = await fs.readFile(path.join(directory, 'tool.manifest.json'), 'utf8');
        return JSON.parse(raw) as ToolDescriptor;
      } catch {
        directory = path.dirname(directory);
      }
    }
  }
  return null;
}

/** GET → list all available tools with install status and download counts. */
export async function GET() {
  const [allTools, installed, downloadCounts] = await Promise.all([
    getAllTools(),
    getInstalledTools(),
    getDownloadCounts(),
  ]);

  const installedIds = new Set(installed.map((t) => t.id));

  const localManifests = await Promise.all(
    installed.map(async (tool) => [tool.id, await readInstalledDescriptor(tool)] as const),
  );
  const localById = new Map(
    localManifests
      .filter(([, descriptor]) => descriptor)
      .map(([id, descriptor]) => [id, descriptor!]),
  );
  const ongoing = getOngoingOperations();
  const tools = allTools.map((tool) => {
    let status: ToolStatus = 'available';
    if (tool.comingSoon) status = 'available';
    else if (ongoing.installing.includes(tool.id)) status = 'installing';
    else if (ongoing.uninstalling.includes(tool.id)) status = 'uninstalling' as ToolStatus;
    else if (installedIds.has(tool.id)) status = 'installed';

    return {
      ...tool,
      ...(localById.get(tool.id) ?? {}),
      // Merge local download counts into the registry data
      downloads: (tool.downloads ?? 0) + (downloadCounts[tool.id] ?? 0),
      status,
      installedAt: installed.find((t) => t.id === tool.id)?.installedAt,
    };
  });

  return NextResponse.json({ tools });
}
