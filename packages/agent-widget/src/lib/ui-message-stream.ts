/**
 * Reader for the AI SDK "UI Message Stream" that the Agent Runtime returns
 * from `toUIMessageStreamResponse()`.
 *
 * The widget parses the wire format directly instead of depending on
 * `@ai-sdk/react`. Two reasons, both product ones:
 *
 * 1. **Size.** This bundle is injected into other people's websites. Pulling in
 *    `ai` + `@ai-sdk/react` roughly triples it for a protocol that is ~100
 *    lines of parsing.
 * 2. **Version independence.** The widget is deployed on customer sites and
 *    updated on our schedule, not theirs. Coupling it to the server's exact AI
 *    SDK version would make every SDK bump a breaking change for embedders.
 *
 * The trade-off is that this file is the contract seam: it is deliberately
 * tolerant (unknown chunk types are ignored, never fatal) and covered by unit
 * tests that encode the frame shapes the runtime emits today.
 *
 * Wire format (`ai@7` `json-to-sse-transform-stream.ts`):
 *   data: {"type":"text-delta","id":"0","delta":"Hel"}\n\n
 *   data: [DONE]\n\n
 */

import type { WidgetBlock } from '../types';

/* ------------------------------------------------------------------ */
/* Frame parsing                                                       */
/* ------------------------------------------------------------------ */

export interface SseParseResult {
  /** Decoded JSON payloads, in order. */
  chunks: unknown[];
  /** Bytes belonging to a frame that has not fully arrived yet. */
  rest: string;
  /** True once the terminal `[DONE]` sentinel was seen. */
  done: boolean;
}

/**
 * Split a (possibly partial) SSE buffer into decoded chunks.
 *
 * Only complete frames are consumed; the trailing partial frame is handed back
 * as `rest` so the caller can prepend it to the next network read.
 */
export function parseSseBuffer(buffer: string): SseParseResult {
  const chunks: unknown[] = [];
  let done = false;

  // Normalize CRLF so a proxy that rewrites line endings cannot break framing.
  const normalized = buffer.replace(/\r\n/g, '\n');
  const lastBreak = normalized.lastIndexOf('\n\n');
  if (lastBreak === -1) return { chunks, rest: normalized, done };

  const complete = normalized.slice(0, lastBreak);
  const rest = normalized.slice(lastBreak + 2);

  for (const frame of complete.split('\n\n')) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue; // ignore `event:`/`id:`/comments
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === '[DONE]') {
        done = true;
        continue;
      }
      try {
        chunks.push(JSON.parse(payload));
      } catch {
        // A frame we cannot decode is dropped rather than aborting the turn.
      }
    }
  }

  return { chunks, rest, done };
}

/* ------------------------------------------------------------------ */
/* Chunk interpretation                                                */
/* ------------------------------------------------------------------ */

/** Running state of one assistant turn. */
export interface TurnState {
  text: string;
  blocks: WidgetBlock[];
  /** Set when the server reported an error mid-stream. */
  errorText?: string;
  /** Set when the run was aborted before finishing. */
  aborted?: boolean;
  finished: boolean;
}

export function createTurnState(): TurnState {
  return { text: '', blocks: [], finished: false };
}

interface RawChunk {
  type?: unknown;
  id?: unknown;
  delta?: unknown;
  errorText?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  title?: unknown;
  url?: unknown;
  mediaType?: unknown;
  sourceId?: unknown;
  filename?: unknown;
  data?: unknown;
  transient?: unknown;
}

function upsertBlock(blocks: WidgetBlock[], block: WidgetBlock): WidgetBlock[] {
  const index = blocks.findIndex((b) => b.key === block.key);
  if (index === -1) return [...blocks, block];
  const next = blocks.slice();
  next[index] = block;
  return next;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Coerce a `data-*` payload into an allow-listed block, or drop it. */
function dataBlock(name: string, key: string, data: unknown): WidgetBlock | null {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;

    if (record.type === 'table' && Array.isArray(record.columns) && Array.isArray(record.rows)) {
      return {
        key,
        type: 'table',
        columns: record.columns.map((c) => String(c)),
        rows: record.rows
          .filter(Array.isArray)
          .map((row) =>
            (row as unknown[]).map((cell) =>
              cell === null || typeof cell === 'number' ? cell : String(cell ?? ''),
            ),
          ),
      };
    }

    if (record.type === 'citation') {
      return {
        key,
        type: 'citation',
        label: str(record.title ?? record.label, name),
        url: typeof record.url === 'string' ? record.url : undefined,
      };
    }
  }

  return { key, type: 'data', label: name, json: data };
}

/**
 * Fold one decoded chunk into the turn state.
 *
 * Returns a new object when something changed and the *same* object when the
 * chunk was irrelevant, so callers can skip a React re-render cheaply.
 */
export function applyChunk(state: TurnState, chunk: unknown): TurnState {
  if (!chunk || typeof chunk !== 'object') return state;
  const c = chunk as RawChunk;
  const type = typeof c.type === 'string' ? c.type : '';

  switch (type) {
    case 'text-delta':
      return typeof c.delta === 'string' && c.delta
        ? { ...state, text: state.text + c.delta }
        : state;

    case 'error':
      return { ...state, errorText: str(c.errorText, 'The agent hit an error.'), finished: true };

    case 'abort':
      return { ...state, aborted: true, finished: true };

    case 'finish':
      return { ...state, finished: true };

    case 'tool-input-start':
      return {
        ...state,
        blocks: upsertBlock(state.blocks, {
          key: `tool:${str(c.toolCallId, 'unknown')}`,
          type: 'status',
          label: str(c.title) || str(c.toolName, 'Working'),
          state: 'running',
        }),
      };

    case 'tool-output-available':
    case 'tool-output-error': {
      const key = `tool:${str(c.toolCallId, 'unknown')}`;
      const existing = state.blocks.find((b) => b.key === key);
      const label = existing && existing.type === 'status' ? existing.label : 'Tool';
      return {
        ...state,
        blocks: upsertBlock(state.blocks, {
          key,
          type: 'status',
          label,
          state: type === 'tool-output-error' ? 'error' : 'done',
        }),
      };
    }

    case 'source-url':
      return {
        ...state,
        blocks: upsertBlock(state.blocks, {
          key: `source:${str(c.sourceId, str(c.url))}`,
          type: 'citation',
          label: str(c.title) || str(c.url, 'Source'),
          url: str(c.url) || undefined,
        }),
      };

    case 'source-document':
      return {
        ...state,
        blocks: upsertBlock(state.blocks, {
          key: `source:${str(c.sourceId, str(c.title))}`,
          type: 'citation',
          label: str(c.title) || str(c.filename, 'Document'),
        }),
      };

    case 'file': {
      const url = str(c.url);
      if (!url) return state;
      return {
        ...state,
        blocks: upsertBlock(state.blocks, {
          key: `file:${url}`,
          type: 'file',
          url,
          mediaType: str(c.mediaType, 'application/octet-stream'),
        }),
      };
    }

    default: {
      if (type.startsWith('data-')) {
        // `transient: true` means "show while streaming, do not persist"; the
        // widget has no persistence, so it renders like any other data block.
        const name = type.slice('data-'.length);
        const block = dataBlock(name, `data:${str(c.id, name)}`, c.data);
        return block ? { ...state, blocks: upsertBlock(state.blocks, block) } : state;
      }
      // text-start / text-end / reasoning-* / start / start-step / finish-step /
      // tool-input-delta / message-metadata / custom: nothing to render.
      return state;
    }
  }
}
