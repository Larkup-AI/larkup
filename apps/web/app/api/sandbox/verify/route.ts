import { NextResponse } from 'next/server';
import { verifySandboxProvider } from '@larkup/sandbox';
import { getSandboxProvider } from '@larkup/sandbox/registry';
import type { SandboxBackend } from '@larkup/sandbox/types';
import { readConfig } from '@larkup/core/config-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reports the active Project sandbox without ever returning credentials. */
export async function GET() {
  const config = await readConfig();
  const provider = (config.defaultSandboxProvider as SandboxBackend) || 'local';
  try {
    await verifySandboxProvider(provider, config.sandboxProviderConfigs?.[provider] ?? {});
    return NextResponse.json({ provider, status: 'ready', message: 'Ready for code execution.' });
  } catch (error) {
    return NextResponse.json({
      provider,
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'Sandbox preflight failed.',
    });
  }
}

export async function POST(req: Request) {
  try {
    const { provider, credentials } = await req.json();

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }
    if (
      provider !== 'local' &&
      provider !== 'docker' &&
      !getSandboxProvider(provider as SandboxBackend)
    ) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    await verifySandboxProvider(provider as SandboxBackend, credentials ?? {});
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
