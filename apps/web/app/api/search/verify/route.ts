import { NextResponse } from 'next/server';
import {
  isSearchVerificationProvider,
  verifySearchProvider,
} from '@/lib/search-provider-verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { provider, apiKey } = await req.json();

    if (!provider || !apiKey) {
      return NextResponse.json({ error: 'Provider and API key are required' }, { status: 400 });
    }

    if (!isSearchVerificationProvider(provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    await verifySearchProvider(provider, apiKey);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
