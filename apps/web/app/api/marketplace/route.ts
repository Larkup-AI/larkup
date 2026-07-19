import { NextResponse } from 'next/server';
import { getAllTools } from '@larkup/marketplace/registry';
import { getInstalledTools, getDownloadCounts } from '@larkup/marketplace/installer';
import type { ToolStatus } from '@larkup/marketplace/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → list all available tools with install status and download counts. */
export async function GET() {
  const [allTools, installed, downloadCounts] = await Promise.all([
    getAllTools(),
    getInstalledTools(),
    getDownloadCounts(),
  ]);

  const installedIds = new Set(installed.map((t) => t.id));

  const tools = allTools.map((tool) => ({
    ...tool,
    // Merge local download counts into the registry data
    downloads: (tool.downloads ?? 0) + (downloadCounts[tool.id] ?? 0),
    status: (tool.comingSoon
      ? 'available'
      : installedIds.has(tool.id)
      ? 'installed'
      : 'available') as ToolStatus,
    installedAt: installed.find((t) => t.id === tool.id)?.installedAt,
  }));

  return NextResponse.json({ tools });
}
