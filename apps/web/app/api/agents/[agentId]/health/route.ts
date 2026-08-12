import { NextRequest, NextResponse } from 'next/server';
import { readAgent, getActiveReleaseId } from '@larkup/core/agent-store';
import { getToolAdmissionDecisions } from '@larkup/core/agent-runtime';
import { resolveExecutionEnvironment } from '@larkup/agent-contracts/execution';
import { getChannel } from '@larkup/channels-core';

type Params = { params: Promise<{ agentId: string }> };

/**
 * GET /api/agents/[agentId]/health
 *
 * Operator-facing readiness: can this agent answer, where does it run, which of
 * its tools were admitted, and are its channels configured?
 *
 * The tool section exists because a refused tool must be *visible* (plan §6):
 * an agent that silently lost its media tool on a serverless target gives wrong
 * answers with no explanation.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { agentId } = await params;

    const agent = await readAgent(agentId);
    if (!agent) {
      return NextResponse.json({ status: 'not_found', error: 'Agent not found' }, { status: 404 });
    }

    const activeReleaseId = await getActiveReleaseId(agentId);
    const environment = resolveExecutionEnvironment();

    // Populated by the most recent turn. Empty before the agent has run once.
    const decisions = getToolAdmissionDecisions(agentId);
    const refused = decisions.filter((d) => !d.admitted);

    const channels = Object.entries(agent.channels ?? {})
      .filter(([, channel]) => channel.enabled)
      .map(([id, channel]) => ({
        id,
        name: getChannel(id)?.name ?? id,
        lastInboundAt: channel.lastInboundAt,
        lastError: channel.lastError,
        lastErrorAt: channel.lastErrorAt,
      }));

    return NextResponse.json({
      status: activeReleaseId ? 'ready' : 'needs_publish',
      agentId,
      activeReleaseId,
      ...(activeReleaseId
        ? {}
        : {
            message: 'Agent created but no release has been published and activated yet.',
          }),
      environment: {
        target: environment.target,
        maxTrustLevel: environment.maxTrustLevel,
        hasPersistentStorage: environment.hasPersistentStorage,
        canExec: environment.canExec,
        limits: environment.limits,
        region: environment.region,
      },
      tools: {
        enabled: agent.enabledToolIds ?? [],
        // `[]` before the first turn — say so rather than implying all is well.
        evaluated: decisions.length > 0,
        admitted: decisions.filter((d) => d.admitted).map((d) => d.toolId),
        refused: refused.map((d) => ({
          toolId: d.toolId,
          reason: d.reason,
          detail: d.detail,
        })),
      },
      channels,
    });
  } catch (error) {
    return NextResponse.json({ status: 'error', error: String(error) }, { status: 500 });
  }
}
