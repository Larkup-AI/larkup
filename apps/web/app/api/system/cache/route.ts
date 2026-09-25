import { NextResponse } from 'next/server';
import { clearGeneralFilesystemCaches, getGeneralCacheStatus } from '@/lib/system-cache';
import { getLarkupDataDir, getProjectWorkspace, runWithProject } from '@larkup/core/project-store';
import { clearImageAnalysisCache } from '@larkup/core/image-analysis-cache';
import { clearVideoSemanticIndexCache } from '@larkup/core/video-knowledge/evidence-semantic-index';
import { clearVideoKnowledgeRuntimeCaches } from '@larkup/core/video-knowledge/answer-memory-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const cache = await getGeneralCacheStatus(process.cwd(), getLarkupDataDir());
    return NextResponse.json({ cache }, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[system-cache] failed to inspect Larkup cache:', error);
    return NextResponse.json(
      { error: 'Could not inspect the Larkup cache.' },
      { status: 500, headers: noStoreHeaders },
    );
  }
}

export async function DELETE() {
  try {
    const before = await getGeneralCacheStatus(process.cwd(), getLarkupDataDir());
    await clearGeneralFilesystemCaches(process.cwd(), getLarkupDataDir());
    const workspace = await getProjectWorkspace();
    for (const project of workspace.projects) {
      await runWithProject(project.id, async () => {
        await clearImageAnalysisCache();
        await clearVideoSemanticIndexCache();
        await clearVideoKnowledgeRuntimeCaches();
      });
    }
    // Core cleanup reads durable project state and may initialize a derived
    // cache file in a legacy workspace. Sweep filesystem caches once more so
    // the DELETE response reflects the fully settled post-clear state.
    await clearGeneralFilesystemCaches(process.cwd(), getLarkupDataDir());
    const cache = await getGeneralCacheStatus(process.cwd(), getLarkupDataDir());
    const clearedBytes = Math.max(0, before.sizeBytes - cache.sizeBytes);
    return NextResponse.json({ cache, clearedBytes }, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[system-cache] failed to clear Larkup cache:', error);
    return NextResponse.json(
      { error: 'Could not clear the Larkup cache.' },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
