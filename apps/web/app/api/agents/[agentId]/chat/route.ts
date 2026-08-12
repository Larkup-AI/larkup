import { NextRequest } from 'next/server';
import { streamAgentChatResponse } from '@larkup/core/agent-runtime';
import { normalizeAgentMessages } from '@larkup/agent-contracts/protocol';
import {
  authorizeAgentRequest,
  handleAgentPreflight,
  isDenied,
  withCors,
} from '@/lib/agent-access';
import {
  chargeDailyBudget,
  checkMessageQuota,
  precheckDailyBudget,
  rateLimitResponse,
} from '@/lib/agent-rate-limit';

export const maxDuration = 60;

type Params = { params: Promise<{ agentId: string }> };

/**
 * OPTIONS /api/agents/[agentId]/chat
 *
 * The widget runs on the customer's domain, so every chat request is
 * cross-origin and preceded by a preflight. Answering it is what makes the
 * allow-list enforceable in the browser rather than merely advisory.
 */
export async function OPTIONS(req: NextRequest, { params }: Params) {
  const { agentId } = await params;
  return handleAgentPreflight(req, agentId);
}

/**
 * POST /api/agents/[agentId]/chat
 *
 * Streams a UI Message Stream response from the Agent Runtime.
 *
 * Body: { messages: AgentMessage[] | UIMessage[]; retrievalTopK?: number; testMode?: boolean }
 *
 * Both message shapes are accepted: the SDKs and channels send
 * `{ role, content }`, the AI SDK `useChat()` hook sends `parts`.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params;

  const access = await authorizeAgentRequest(req, agentId);
  if (isDenied(access)) return access.denied;
  const { cors } = access;

  try {
    const body = (await req.json()) as {
      messages?: unknown;
      retrievalTopK?: number;
      testMode?: boolean;
    };

    const messages = normalizeAgentMessages(body.messages);
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // Messages/session and the daily token ceiling (plan §8.5) — chat-
    // specific, so checked here rather than in `authorizeAgentRequest`
    // (which already enforced the requests/minute limit for every
    // browser-facing endpoint, including this one).
    const messageQuota = checkMessageQuota(agentId, req);
    if (!messageQuota.allowed) return rateLimitResponse(messageQuota, cors);

    const dailyCeiling = access.definition.dailyTokenCeiling;
    const budget = precheckDailyBudget(agentId, dailyCeiling);
    if (!budget.allowed) return rateLimitResponse(budget, cors);

    // Test mode runs the draft definition instead of the active release so an
    // operator can try an agent before publishing (TASK 04).
    const definition = body.testMode ? access.definition : undefined;

    const response = await streamAgentChatResponse(agentId, {
      messages,
      retrievalTopK: body.retrievalTopK,
      definition,
      signal: req.signal,
      // Charged after the run, not gated by it — the actual cost of a turn
      // is only known once it has already happened.
      onUsage: (usage) => chargeDailyBudget(agentId, usage.totalTokens ?? 0, dailyCeiling),
    });

    return withCors(response, cors);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[agent-chat]', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
