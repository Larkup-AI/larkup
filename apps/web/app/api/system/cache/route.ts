import { NextResponse } from 'next/server';
import { clearBuildCache, getBuildCacheStatus } from '@/lib/system-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const cache = await getBuildCacheStatus();
    return NextResponse.json({ cache }, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[system-cache] failed to inspect build cache:', error);
    return NextResponse.json(
      { error: 'Could not inspect the build cache.' },
      { status: 500, headers: noStoreHeaders },
    );
  }
}

export async function DELETE() {
  try {
    const clearedBytes = await clearBuildCache();
    const cache = await getBuildCacheStatus();
    return NextResponse.json({ cache, clearedBytes }, { headers: noStoreHeaders });
  } catch (error) {
    console.error('[system-cache] failed to clear build cache:', error);
    return NextResponse.json(
      { error: 'Could not clear the build cache.' },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
