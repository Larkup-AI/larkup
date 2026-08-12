/**
 * Access control for browser-facing Agent endpoints.
 *
 * The embedded widget authenticates with nothing but a public Agent ID
 * (ADR-004), so the agent's `allowedOrigins` list is the boundary that keeps a
 * stranger's website from spending the operator's model budget. Every route the
 * widget can reach — chat and public config — goes through
 * `authorizeAgentRequest` before doing any work.
 *
 * The matching itself lives in `@larkup/agent-contracts/origin` so that
 * generated agent servers and future channel adapters decide identically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveRelease, readAgent } from '@larkup/core/agent-store';
import {
  agentCorsHeaders,
  checkAgentOrigin,
  originDenialMessage,
  type OriginDecision,
} from '@larkup/agent-contracts/origin';
import type { AgentDefinition } from '@larkup/agent-contracts';
import { checkRequestRate, rateLimitResponse } from './agent-rate-limit';

export interface AgentAccess {
  /** Draft definition when it exists, otherwise the active release snapshot. */
  definition: AgentDefinition;
  decision: OriginDecision;
  /** CORS headers to attach to every response on this request. */
  cors: Record<string, string>;
}

/** Denial carries the response to return verbatim. */
export interface AgentAccessDenied {
  denied: Response;
}

export type AgentAccessResult = AgentAccess | AgentAccessDenied;

export function isDenied(result: AgentAccessResult): result is AgentAccessDenied {
  return 'denied' in result;
}

/**
 * Load the definition that governs *access* for an agent.
 *
 * The draft definition wins over the active release snapshot. Origins,
 * auth mode, and join code are operational access settings, not agent
 * behavior: an operator must be able to add a domain — or revoke one during an
 * incident — without publishing a release. Everything that affects the agent's
 * answers still comes from the immutable release (ADR-002).
 */
async function loadAccessDefinition(agentId: string): Promise<AgentDefinition | null> {
  const draft = await readAgent(agentId);
  if (draft) return draft;
  const release = await getActiveRelease(agentId);
  return release?.definition ?? null;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Enforce `authMode`. Returns an error response, or null when authorized. */
function checkAuth(
  definition: AgentDefinition,
  req: NextRequest,
  cors: Record<string, string>,
): Response | null {
  switch (definition.authMode) {
    case 'join-code': {
      const supplied = req.headers.get('x-larkup-join-code')?.trim();
      const expected = definition.joinCode?.trim();
      if (!expected) {
        return jsonResponse(
          { error: 'This agent requires a join code but none is configured.' },
          503,
          cors,
        );
      }
      if (supplied !== expected) {
        return jsonResponse({ error: 'A valid join code is required for this agent.' }, 401, cors);
      }
      return null;
    }

    case 'api-key':
      // Scoped, hashed, rotatable Agent API keys are TASK 08's key store. Until
      // that exists there is nothing to verify a key against, so this fails
      // closed rather than quietly serving an agent the operator marked as
      // key-protected.
      return jsonResponse(
        {
          error:
            'authMode "api-key" is not enforceable yet (scoped Agent API keys ship with the control plane). Use "none" or "join-code".',
        },
        501,
        cors,
      );

    case 'none':
    default:
      return null;
  }
}

/**
 * Resolve the agent, check the request origin, and check auth.
 *
 * Denials are returned as ready-made responses so every caller reports them the
 * same way — including the CORS headers, without which the browser would show a
 * generic network error instead of the real reason.
 */
export async function authorizeAgentRequest(
  req: NextRequest,
  agentId: string,
): Promise<AgentAccessResult> {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const selfOrigin = new URL(req.url).origin;

  const definition = await loadAccessDefinition(agentId);

  if (!definition) {
    // Deny with the same shape a blocked origin gets, minus the allow-list
    // details: probing for which agent IDs exist should not be free.
    const decision = checkAgentOrigin({ origin, referer, selfOrigin, allowedOrigins: ['*'] });
    return {
      denied: jsonResponse(
        { error: `Agent "${agentId}" not found` },
        404,
        agentCorsHeaders(decision),
      ),
    };
  }

  const decision = checkAgentOrigin({
    origin,
    referer,
    selfOrigin,
    allowedOrigins: definition.allowedOrigins,
  });
  const cors = agentCorsHeaders(decision);

  if (!decision.allowed) {
    console.warn(
      `[agent-access] blocked ${req.method} ${agentId} from ${decision.origin} (${decision.reason})`,
    );
    return { denied: jsonResponse({ error: originDenialMessage(decision) }, 403, cors) };
  }

  // Requests/minute per visitor (plan §8.5) — the origin allow-list says who
  // may call this agent, not how much. Checked before auth: a caller
  // spamming a wrong join code should not get an unbounded number of guesses.
  const rate = checkRequestRate(agentId, req);
  if (!rate.allowed) {
    return { denied: rateLimitResponse(rate, cors) };
  }

  const authError = checkAuth(definition, req, cors);
  if (authError) return { denied: authError };

  return { definition, decision, cors };
}

/**
 * Handle a CORS preflight.
 *
 * A preflight carries no body and no credentials, so it only answers "may this
 * origin talk to this agent at all". Auth is checked on the real request.
 */
export async function handleAgentPreflight(req: NextRequest, agentId: string): Promise<Response> {
  const definition = await loadAccessDefinition(agentId);
  const decision = checkAgentOrigin({
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
    selfOrigin: new URL(req.url).origin,
    allowedOrigins: definition?.allowedOrigins ?? [],
  });

  return new Response(null, {
    status: decision.allowed ? 204 : 403,
    headers: agentCorsHeaders(decision),
  });
}

/** Attach CORS headers to an already-built response (including a stream). */
export function withCors<T extends Response>(response: T, cors: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** JSON helper that keeps CORS headers on non-denial responses too. */
export function corsJson(
  body: unknown,
  init: { status?: number; cors: Record<string, string> },
): NextResponse {
  return NextResponse.json(body, { status: init.status ?? 200, headers: init.cors });
}
