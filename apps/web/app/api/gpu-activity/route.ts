import { NextResponse } from 'next/server';
import { readGpuActivity } from '@larkup/core/gpu-activity-store';

export const dynamic = 'force-dynamic';

/** Polled by GpuActivityIndicator; mirrors /api/index's shape and scoping. */
export async function GET() {
  const activity = await readGpuActivity();
  return NextResponse.json({ activity });
}
