import {
  isSearchVerificationProvider,
  verifySearchProvider,
} from '@larkup/workspace-server/lib/search/provider-verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { provider, apiKey } = await req.json();

    if (!provider || !apiKey) {
      return Response.json({ error: 'Provider and API key are required' }, { status: 400 });
    }

    if (!isSearchVerificationProvider(provider)) {
      return Response.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    await verifySearchProvider(provider, apiKey);
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return Response.json({ error: message }, { status: 400 });
  }
}
