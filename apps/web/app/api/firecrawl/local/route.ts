import { NextResponse } from 'next/server';
import {
  checkDocker,
  readLocalState,
  refreshLocalStatus,
  startLocal,
  stopLocal,
  isInsideDocker,
  checkDockerSibling,
  connectDockerSibling,
} from '@larkup/scraper/local-runtime';
import { getRuntimeEnv } from '@/lib/env-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → current local instance state + docker availability + runtime env. */
export async function GET() {
  const runtimeEnv = getRuntimeEnv();

  if (runtimeEnv === 'docker') {
    const [state, sibling] = await Promise.all([refreshLocalStatus(), checkDockerSibling()]);
    const { apiKey, ...safe } = state;
    return NextResponse.json({
      state: {
        ...safe,
        hasKey: Boolean(apiKey),
        // If the sibling is up, update running state
        running: state.running || sibling.available,
        endpoint: sibling.available ? sibling.endpoint : safe.endpoint,
      },
      docker: {
        docker: true,
        compose: sibling.available,
        message: sibling.available
          ? 'Crawler service is running.'
          : 'Crawler service is not running. Restart with: docker compose --profile crawler up',
      },
      runtimeEnv,
    });
  }

  // Desktop or web — check Docker CLI availability
  const [state, docker] = await Promise.all([refreshLocalStatus(), checkDocker()]);
  const { apiKey, ...safe } = state;
  return NextResponse.json({
    state: { ...safe, hasKey: Boolean(apiKey) },
    docker,
    runtimeEnv,
  });
}

/** POST { action: "start" | "stop" } → control the local Firecrawl container. */
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
      const state = await connectDockerSibling();
      const { apiKey, ...safe } = state;
      return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } });
    } else {
      const state = await readLocalState();
      const { apiKey, ...safe } = state;
      return NextResponse.json({
        state: { ...safe, running: false, hasKey: Boolean(apiKey) },
      });
    }
  }

  // Web / Desktop: use docker compose CLI
  const state = action === 'start' ? await startLocal() : await stopLocal();
  const { apiKey, ...safe } = state;
  return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } });
}
