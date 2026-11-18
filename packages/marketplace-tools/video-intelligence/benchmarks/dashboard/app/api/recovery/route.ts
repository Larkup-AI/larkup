import { NextResponse } from 'next/server';
import { readRecovery } from '../../../lib/server/recovery';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const recovery = await readRecovery(new URL(request.url).searchParams.get('run') ?? '');
    return NextResponse.json(recovery, {
      status: recovery ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Current recovery results could not be validated.' },
      { status: 503 },
    );
  }
}
