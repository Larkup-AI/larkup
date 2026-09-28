import { NextResponse } from 'next/server';
import {
  refreshLocalStatus,
  startNativeLocal,
  stopLocal,
  checkDockerSibling,
  connectDockerSibling,
} from '@larkup/scraper/local-runtime';
import { getRuntimeEnv } from '@/lib/runtime/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ensureBuiltInCrawler() {
  const state = await refreshLocalStatus();
  return state.running && state.mode === 'native' && !state.lastError ? state : startNativeLocal();
}

/** GET → ensure and report the crawler runtime available through the app API. */
export async function GET() {
  const runtimeEnv = getRuntimeEnv();

  if (runtimeEnv === 'docker') {
    const sibling = await checkDockerSibling();
    const state = sibling.available ? await connectDockerSibling() : await ensureBuiltInCrawler();
    const { apiKey, ...safe } = state;
    return NextResponse.json({
      state: { ...safe, hasKey: Boolean(apiKey) },
      runtimeEnv,
    });
  }

  // Web, desktop, npm and curl installations all use the crawler embedded in
  // this process. A Docker daemon or a separately launched browser service is
  // never required on the end user's computer.
  const state = await ensureBuiltInCrawler();
  const { apiKey, ...safe } = state;
  return NextResponse.json({
    state: { ...safe, hasKey: Boolean(apiKey) },
    runtimeEnv,
  });
}

/** POST { action: "start" | "stop" } → control the crawler exposed by this app API. */
export async function POST(req: Request) {
  const runtimeEnv = getRuntimeEnv();

  let action: string | undefined;
  try {
    ({ action } = (await req.json()) as { action?: string });
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json({ error: 'action must be "start" or "stop".' }, { status: 400 });
  }

  if (runtimeEnv === 'docker') {
    if (action === 'start') {
      // A `docker run` container cannot create sibling containers. Attach to
      // an optional Firecrawl sibling when present, otherwise use the built-in
      // crawler that runs in this Larkup process.
      const sibling = await checkDockerSibling();
      const state = sibling.available ? await connectDockerSibling() : await startNativeLocal();
      const { apiKey, ...safe } = state;
      return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } });
    } else {
      const state = await stopLocal();
      const { apiKey, ...safe } = state;
      return NextResponse.json({
        state: { ...safe, hasKey: Boolean(apiKey) },
      });
    }
  }

  if (action === 'start') {
    const state = await startNativeLocal();
    const { apiKey, ...safe } = state;
    return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) }, starting: false });
  }

  const state = await stopLocal();
  const { apiKey, ...safe } = state;
  return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } });
}
