import { NextRequest } from 'next/server';
import { getActiveReleaseId } from '@larkup/core/agent-store';
import { DEFAULT_WIDGET_STYLE } from '@larkup/agent-contracts';
import {
  authorizeAgentRequest,
  corsJson,
  handleAgentPreflight,
  isDenied,
} from '@/lib/agent-access';

type Params = { params: Promise<{ agentId: string }> };

export async function OPTIONS(req: NextRequest, { params }: Params) {
  const { agentId } = await params;
  return handleAgentPreflight(req, agentId);
}

/**
 * GET /api/agents/[agentId]/public
 *
 * The **only** agent data a browser is ever given: display name, status, auth
 * mode, and widget styling.
 *
 * This endpoint exists because `GET /api/agents/[agentId]` returns the full
 * definition — including `knowledgeSources[].retrievalKey`, the system prompt,
 * and the enabled tool list. None of that may reach a visitor's browser
 * (plan §8.3), so the widget reads this redacted projection instead. Add fields
 * here only after asking whether a stranger on the internet may see them.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const access = await authorizeAgentRequest(req, agentId);
  if (isDenied(access)) return access.denied;

  const { definition, cors } = access;
  const activeReleaseId = await getActiveReleaseId(agentId);

  return corsJson(
    {
      agentId: definition.id,
      name: definition.name,
      description: definition.description || undefined,
      status: activeReleaseId ? 'ready' : 'needs_publish',
      authMode: definition.authMode ?? 'none',
      widgetStyle: { ...DEFAULT_WIDGET_STYLE, ...(definition.widgetStyle ?? {}) },
    },
    {
      cors: {
        ...cors,
        // Short cache: an operator restyling the widget expects the change to
        // show up quickly, but every page view should not hit the origin.
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    },
  );
}
