import { defineAgentTool, type AgentToolExecutionContext } from '@larkup/marketplace/extension';
import type { VideoIntelligenceClient } from './client.js';

const MAX_INSPECTION_CHUNK_SECS = 60;

type InspectionPurpose = 'verify-visual' | 'high-res-ocr' | 'compare' | 'count' | 'track' | 'code';

interface InspectVideoKnowledgeInput {
  mediaAssetId: string;
  startSecs: number;
  endSecs: number;
  purpose: InspectionPurpose;
  queryId: string;
  question?: string;
  maxFrames?: number;
}

export interface VideoIntelligenceAgentClient extends VideoIntelligenceClient {
  inspectVideoKnowledge(
    input: InspectVideoKnowledgeInput,
    context: AgentToolExecutionContext,
  ): Promise<unknown>;
}

/**
 * This is the only chat-specific export the host needs to discover. The
 * action's input, instruction, bounded execution, and workflow role travel
 * with the marketplace package.
 */
export const AGENT_TOOLS = [
  defineAgentTool({
    name: 'inspectVideoKnowledge',
    description:
      'Use when an evidence query requires corroboration. Inspect only the returned bounded range, then query the evidence again before answering. This obtains fresh visual, OCR, and tracking evidence; it never scans an entire video.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaAssetId', 'startSecs', 'endSecs', 'purpose', 'queryId'],
      properties: {
        mediaAssetId: { type: 'string' },
        startSecs: { type: 'number', minimum: 0 },
        endSecs: { type: 'number', minimum: 0 },
        purpose: {
          type: 'string',
          enum: ['verify-visual', 'high-res-ocr', 'compare', 'count', 'track', 'code'],
        },
        queryId: { type: 'string', minLength: 1, maxLength: 128 },
        question: { type: 'string', minLength: 1, maxLength: 2000 },
        maxFrames: { type: 'integer', minimum: 1, maximum: 24 },
      },
    },
    method: 'inspectVideoKnowledge',
    workflow: 'evidence-refinement',
    systemPromptFragment:
      'When this tool returns fresh evidence, re-query the relevant evidence source before making the claim.',
  }),
];

export function attachVideoIntelligenceAgentClient(
  client: VideoIntelligenceClient,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): VideoIntelligenceAgentClient {
  return Object.assign(client, {
    async inspectVideoKnowledge(
      input: InspectVideoKnowledgeInput,
      context: AgentToolExecutionContext,
    ) {
      if (!context.origin) {
        return {
          success: false,
          error: 'Source inspection is unavailable without a request origin.',
        };
      }
      if (!isValidInspectionInput(input)) {
        return { success: false, error: 'The requested inspection range is invalid.' };
      }

      const url = new URL('/api/media/inspect', context.origin);
      if (context.projectId) url.searchParams.set('projectId', context.projectId);
      const chunks = splitRange(
        input.startSecs,
        input.endSecs,
        MAX_INSPECTION_CHUNK_SECS,
      ).reverse();
      let lastResult: Record<string, unknown> = { error: 'No inspectable range was provided.' };
      let lastOk = false;

      for (const chunk of chunks) {
        const response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaAssetId: input.mediaAssetId,
            startSecs: chunk.startSecs,
            endSecs: chunk.endSecs,
            purpose: input.purpose,
            queryId: `${input.queryId}:${chunk.startSecs}`.slice(0, 128),
            question: input.question ?? input.queryId,
            maxFrames: input.maxFrames,
            toolCallId: context.toolCallId,
          }),
        });
        lastResult = await response
          .json()
          .catch(() => ({ error: 'Inspection returned an invalid response.' }));
        lastOk = response.ok;
        if (lastOk && Array.isArray(lastResult.evidence) && lastResult.evidence.length > 0) break;
      }
      return lastOk ? { success: true, ...lastResult } : { success: false, ...lastResult };
    },
  });
}

function isValidInspectionInput(input: InspectVideoKnowledgeInput): boolean {
  return (
    typeof input.mediaAssetId === 'string' &&
    input.mediaAssetId.length > 0 &&
    Number.isFinite(input.startSecs) &&
    Number.isFinite(input.endSecs) &&
    input.startSecs >= 0 &&
    input.endSecs > input.startSecs &&
    ['verify-visual', 'high-res-ocr', 'compare', 'count', 'track', 'code'].includes(
      input.purpose,
    ) &&
    typeof input.queryId === 'string' &&
    input.queryId.length > 0
  );
}

function splitRange(startSecs: number, endSecs: number, maxChunkSecs: number) {
  const chunks: Array<{ startSecs: number; endSecs: number }> = [];
  for (let cursor = startSecs; cursor < endSecs; cursor += maxChunkSecs) {
    chunks.push({ startSecs: cursor, endSecs: Math.min(endSecs, cursor + maxChunkSecs) });
  }
  return chunks;
}
