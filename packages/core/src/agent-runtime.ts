/**
 * Agent Runtime — streams a chat response for a given AgentDefinition.
 *
 * Responsibilities:
 * 1. Build the system prompt (definition.systemPrompt + knowledge context)
 * 2. Fan-out retrieval to all configured Knowledge Sources
 * 3. Compose typed tools from the agent's enabledToolIds (trust-gated)
 * 4. Stream via Vercel AI SDK v7 (streamText → toUIMessageStreamResponse)
 *
 * Trust enforcement:
 * - The runtime resolves the execution environment at startup.
 * - Tool invocations are rejected if their required trustLevel exceeds
 *   the environment's maxTrustLevel (e.g., Vercel caps at "standard").
 */

import { streamText, generateText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createCohere } from '@ai-sdk/cohere';
import { getActiveRelease } from './agent-store';
import { resolveExecutionEnvironment, admitTool } from '@larkup/agent-contracts';
import type { ExecutionDecision } from '@larkup/agent-contracts';
import { lastUserMessage, normalizeAgentMessages } from '@larkup/agent-contracts/protocol';
import type { AgentDefinition } from '@larkup/agent-contracts';

/* ------------------------------------------------------------------ */
/* Execution environment (resolved once per process)                  */
/* ------------------------------------------------------------------ */

const execEnv = resolveExecutionEnvironment();

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * A chat turn. Callers may also pass AI SDK `UIMessage`s (the shape the widget's
 * `useChat`-compatible clients send) — `streamAgentChatResponse` normalizes
 * both through `@larkup/agent-contracts/protocol`.
 */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentChatOptions {
  messages: AgentMessage[] | unknown[];
  /** Override the active release definition (e.g. for local test mode) */
  definition?: AgentDefinition;
  /** Maximum chunks to retrieve per Knowledge Source */
  retrievalTopK?: number;
  /** AbortSignal for client disconnects */
  signal?: AbortSignal;
  /**
   * Called once the run completes, with the AI SDK's reported token usage.
   * Used for cost metering (plan §8.5) and observability (plan §12) by
   * callers in `apps/web` — this package does not depend on either, so it
   * only reports usage rather than acting on it. Errors thrown here are
   * swallowed; a metering bug must never break the chat response.
   */
  onUsage?: (usage: AgentUsage) => void;
}

export interface KnowledgeHit {
  sourceLabel: string;
  score: number;
  text: string;
  title?: string;
  url?: string;
  documentId?: string;
}

/* ------------------------------------------------------------------ */
/* Knowledge retrieval fan-out                                         */
/* ------------------------------------------------------------------ */

async function retrieveFromSources(
  definition: AgentDefinition,
  query: string,
  topK: number,
): Promise<KnowledgeHit[]> {
  const sources = definition.knowledgeSources ?? [];
  if (!sources.length) return [];

  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const url = `${source.baseUrl.replace(/\/$/, '')}/query`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${source.retrievalKey}`,
        },
        body: JSON.stringify({ query, topK: source.topK ?? topK }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`KS "${source.label}": HTTP ${res.status}`);
      const data = (await res.json()) as { hits?: unknown[] };
      return (data.hits ?? []).map(
        (h: any): KnowledgeHit => ({
          sourceLabel: source.label,
          score: h.score ?? 0,
          text: h.text ?? '',
          title: h.title,
          url: h.url,
          documentId: h.documentId,
        }),
      );
    }),
  );

  const hits: KnowledgeHit[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') hits.push(...r.value);
    else console.warn('[agent-runtime] retrieval error:', r.reason);
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, topK * sources.length);
}

/* ------------------------------------------------------------------ */
/* System prompt composition                                           */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(definition: AgentDefinition, hits: KnowledgeHit[]): string {
  let prompt = definition.systemPrompt.trim();
  if (!hits.length) return prompt;

  const context = hits
    .map(
      (h, i) =>
        `[Source ${i + 1}${h.title ? ` — ${h.title}` : ''}${
          h.sourceLabel ? ` (${h.sourceLabel})` : ''
        }]\n${h.text.slice(0, 800)}`,
    )
    .join('\n\n---\n\n');

  return `${prompt}\n\n## Relevant Knowledge\n\nUse the following context to answer. Cite sources by [Source N] when relevant.\n\n${context}`;
}

/* ------------------------------------------------------------------ */
/* Tool composition                                                    */
/* ------------------------------------------------------------------ */

/**
 * Admission decisions from the most recent `buildTools` call.
 *
 * Kept so the dashboard and the observability layer can show *why* a tool the
 * operator enabled is not available. A silently skipped tool produces a wrong
 * answer with no explanation, which is the failure mode plan §6 and §12 are
 * written to prevent.
 */
const lastDecisions = new Map<string, ExecutionDecision[]>();

/** Admission decisions recorded for an agent's most recent turn. */
export function getToolAdmissionDecisions(agentId: string): ExecutionDecision[] {
  return lastDecisions.get(agentId) ?? [];
}

async function buildTools(definition: AgentDefinition): Promise<Record<string, unknown>> {
  const toolSet: Record<string, unknown> = {};
  const decisions: ExecutionDecision[] = [];

  for (const toolId of definition.enabledToolIds ?? []) {
    try {
      // Dynamic import via the marketplace loader (avoids bundling all tool code)
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const loaderPath = '@larkup/marketplace/loader';
      const { loadTool } = (await import(loaderPath)) as any;
      const mod = await loadTool(toolId);
      if (!mod?.toolContract) continue;

      const contract = mod.toolContract;

      // Admission gate: trust level *and* the capabilities the tool declares.
      // A privileged tool that shells out is still unusable on a target that
      // cannot fork, and the operator needs to be told which it was.
      const permissions = contract.permissions ?? {};
      const decision = admitTool(execEnv, {
        toolId,
        trustLevel: contract.trustLevel,
        requiresExec: Boolean(permissions.exec),
        // Only a *write* needs durable storage; a read-only tool is happy on an
        // ephemeral target reading its own bundle.
        requiresPersistentStorage: Boolean(permissions.fsWrite),
        requiresNetwork: (permissions.httpAllow?.length ?? 0) > 0,
      });
      decisions.push(decision);

      if (!decision.admitted) {
        console.warn(`[agent-runtime] ${decision.detail}`);
        continue;
      }

      // Build JSON Schema for parameters
      const properties: Record<string, { type: string; description: string; enum?: string[] }> = {};
      const required: string[] = [];
      for (const p of contract.schema.parameters ?? []) {
        properties[p.name] = {
          type: p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string',
          description: p.description ?? '',
          ...(p.enum ? { enum: p.enum } : {}),
        };
        if (p.required) required.push(p.name);
      }

      toolSet[contract.schema.name] = {
        description: contract.schema.description,
        parameters: {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>) => {
          const ctx = {
            invocationId: crypto.randomUUID(),
            agentId: definition.id,
            grantedTrustLevel: execEnv.maxTrustLevel,
            signal: AbortSignal.timeout(contract.timeoutMs ?? 30_000),
            secrets: {} as Record<string, string>,
            trace: (_event: string, _data?: Record<string, unknown>) => {},
            log: (_level: string, msg: string) => console.log(`[tool:${toolId}] ${msg}`),
          };
          const result = await contract.execute(args, ctx);
          return result.ok ? result.output : { error: result.error };
        },
      } as unknown as ReturnType<typeof tool>;
    } catch (err) {
      console.warn(`[agent-runtime] Failed to load tool "${toolId}":`, err);
    }
  }

  lastDecisions.set(definition.id, decisions);
  return toolSet;
}

/* ------------------------------------------------------------------ */
/* Model factory (mirrors chat/route.ts pattern exactly)              */
/* ------------------------------------------------------------------ */

function resolveModel(provider: string, modelId: string) {
  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const apiKey = process.env[`${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`] ?? undefined;

  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case 'mistral':
      return createMistral({ apiKey })(modelName);
    case 'deepseek':
      return createDeepSeek({ apiKey })(modelName);
    case 'cohere':
      return createCohere({ apiKey })(modelName);
    case 'openai':
    default:
      return createOpenAI({ apiKey })(modelName);
  }
}

/* ------------------------------------------------------------------ */
/* Turn preparation (shared by the streaming and buffered entrypoints) */
/* ------------------------------------------------------------------ */

interface PreparedTurn {
  definition: AgentDefinition;
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools: Record<string, unknown>;
  model: unknown;
}

/**
 * Resolve everything a turn needs: release, retrieval, prompt, tools, model.
 *
 * Shared so the streaming path (widget, dashboard) and the buffered path
 * (channels) cannot drift — plan §3.2 requires one runtime for every consumer,
 * and two copies of this sequence would quietly become two products.
 */
async function prepareTurn(
  agentId: string,
  options: AgentChatOptions,
): Promise<PreparedTurn | { error: string; status: number }> {
  const topK = options.retrievalTopK ?? 5;

  // Callers reach this runtime from the dashboard, the SDKs, channels, and the
  // browser widget, and they do not agree on a message shape; the protocol
  // contract reconciles them.
  const messages = normalizeAgentMessages(options.messages);

  let definition: AgentDefinition | undefined = options.definition;
  if (!definition) {
    const release = await getActiveRelease(agentId);
    if (!release) {
      return {
        status: 409,
        error: `Agent "${agentId}" has no active release. Publish one first.`,
      };
    }
    definition = release.definition;
  }

  const hits = await retrieveFromSources(definition, lastUserMessage(messages), topK);

  return {
    definition,
    systemPrompt: buildSystemPrompt(definition, hits),
    messages: messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    tools: await buildTools(definition),
    model: resolveModel(definition.chatProvider, definition.chatModelId),
  };
}

/* ------------------------------------------------------------------ */
/* Buffered entrypoint (channels)                                      */
/* ------------------------------------------------------------------ */

export interface AgentTurnResult {
  text: string;
  agentId: string;
  releaseId?: string;
}

/**
 * Run one turn and return the complete answer as text.
 *
 * Channels need this: Telegram, Slack, and a plain webhook all deliver one
 * finished message, so streaming would only be buffered at the far end anyway
 * (plan §9, "non-streaming fallback"). Same runtime, same release, same tools —
 * only the delivery differs.
 */
export async function runAgentTurn(
  agentId: string,
  options: AgentChatOptions,
): Promise<AgentTurnResult> {
  const prepared = await prepareTurn(agentId, options);
  if ('error' in prepared) throw new Error(prepared.error);

  const result = await generateText({
    model: prepared.model as any,
    system: prepared.systemPrompt,
    messages: prepared.messages,
    ...(Object.keys(prepared.tools).length > 0
      ? { tools: prepared.tools as any, toolChoice: 'auto' as const }
      : {}),
    stopWhen: stepCountIs(5),
    maxRetries: 1,
    abortSignal: options.signal,
  });

  return { text: result.text ?? '', agentId };
}

/* ------------------------------------------------------------------ */
/* Streaming entrypoint (widget, dashboard)                            */
/* ------------------------------------------------------------------ */

/**
 * Returns a `Response` that streams the agent's reply as a
 * Vercel AI SDK UI Message Stream (compatible with useChat).
 */
export async function streamAgentChatResponse(
  agentId: string,
  options: AgentChatOptions,
): Promise<Response> {
  const prepared = await prepareTurn(agentId, options);
  if ('error' in prepared) {
    return new Response(JSON.stringify({ error: prepared.error }), {
      status: prepared.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = streamText({
    model: prepared.model as any,
    system: prepared.systemPrompt,
    messages: prepared.messages,
    ...(Object.keys(prepared.tools).length > 0
      ? { tools: prepared.tools as any, toolChoice: 'auto' as const }
      : {}),
    stopWhen: stepCountIs(5),
    maxRetries: 0,
    abortSignal: options.signal,
    onFinish: (event) => {
      try {
        options.onUsage?.(event.totalUsage ?? {});
      } catch (err) {
        console.warn('[agent-runtime] onUsage callback threw:', err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
