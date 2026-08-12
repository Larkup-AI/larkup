/**
 * @larkup/agent-contracts — Generic output blocks.
 *
 * Output blocks are the typed, renderable results of Agent turns.
 * They are NOT arbitrary publisher React/JavaScript — only the known
 * block types below are accepted.
 *
 * Compatibility policy:
 * - New block types are added with a new `type` discriminant.
 * - Existing block types are never removed (only deprecated).
 * - Unknown block types MUST be rendered by the compatibility renderer
 *   as a `raw` block with a warning, never silently dropped.
 *
 * Schema version: 2.0
 */

/* ------------------------------------------------------------------ */
/* Shared header                                                       */
/* ------------------------------------------------------------------ */

export interface OutputBlockBase {
  /** Stable discriminant string */
  type: string;
  /** Block-level unique ID (for diffing / keying in React) */
  id?: string;
  /**
   * Tool that produced this block, for attribution and tracing.
   * Matches the ToolContract.schema.name.
   */
  sourceToolId?: string;
  /** ISO-8601 timestamp of when this block was produced */
  producedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Plain or markdown text block */
export interface TextOutputBlock extends OutputBlockBase {
  type: 'text';
  content: string;
  /** When true, content is rendered as markdown (default) */
  markdown?: boolean;
}

/* ------------------------------------------------------------------ */
/* JSON / structured data                                              */
/* ------------------------------------------------------------------ */

/** Arbitrary structured data — rendered as collapsible JSON viewer */
export interface JsonOutputBlock extends OutputBlockBase {
  type: 'json';
  value: unknown;
  /** Optional label shown as block title */
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Image                                                               */
/* ------------------------------------------------------------------ */

export interface ImageOutputBlock extends OutputBlockBase {
  type: 'image';
  /** URL or data URI */
  url: string;
  alt?: string;
  /** Original media asset ID if backed by storage */
  assetId?: string;
}

/* ------------------------------------------------------------------ */
/* Video / Audio                                                       */
/* ------------------------------------------------------------------ */

/**
 * Video output block — specifically for the Video Knowledge tool.
 * Includes timestamp range for in-player seeking.
 */
export interface VideoOutputBlock extends OutputBlockBase {
  type: 'video';
  /** URL of the video file */
  url: string;
  title?: string;
  /** Source asset ID */
  assetId?: string;
  /** Optional clip start in seconds */
  startSeconds?: number;
  /** Optional clip end in seconds */
  endSeconds?: number;
}

export interface AudioOutputBlock extends OutputBlockBase {
  type: 'audio';
  url: string;
  title?: string;
  assetId?: string;
  startSeconds?: number;
  endSeconds?: number;
}

/* ------------------------------------------------------------------ */
/* Document editor result                                              */
/* ------------------------------------------------------------------ */

export interface DocumentEditOutputBlock extends OutputBlockBase {
  type: 'document-edit';
  success: boolean;
  action: string;
  sessionId: string;
  fileName?: string;
  totalPages?: number;
  updatedFields?: string[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Code                                                                */
/* ------------------------------------------------------------------ */

export interface CodeOutputBlock extends OutputBlockBase {
  type: 'code';
  language: string;
  code: string;
  /** Optional filename for display */
  filename?: string;
}

/* ------------------------------------------------------------------ */
/* Error                                                               */
/* ------------------------------------------------------------------ */

export interface ErrorOutputBlock extends OutputBlockBase {
  type: 'error';
  error: string;
  code?: string;
  /** Whether the caller can retry */
  retryable?: boolean;
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export interface TableOutputBlock extends OutputBlockBase {
  type: 'table';
  headers: string[];
  rows: unknown[][];
  /** Optional caption */
  caption?: string;
}

/* ------------------------------------------------------------------ */
/* Knowledge citation                                                  */
/* ------------------------------------------------------------------ */

/** Source citation returned by the Knowledge Server retrieval tool */
export interface CitationOutputBlock extends OutputBlockBase {
  type: 'citation';
  documentId: string;
  chunkId?: string;
  title: string;
  excerpt: string;
  url?: string;
  /** Cosine similarity score 0–1 */
  score?: number;
}

/* ------------------------------------------------------------------ */
/* Compatibility / raw fallback                                        */
/* ------------------------------------------------------------------ */

/**
 * Catches unknown future block types.
 * Rendered as a plain text dump with a "Unknown block type" warning.
 * This ensures forward-compatibility: apps on older renderers
 * never silently discard information.
 */
export interface RawOutputBlock extends OutputBlockBase {
  type: 'raw';
  originalType: string;
  data: unknown;
}

/* ------------------------------------------------------------------ */
/* Union                                                               */
/* ------------------------------------------------------------------ */

export type AgentOutputBlock =
  | TextOutputBlock
  | JsonOutputBlock
  | ImageOutputBlock
  | VideoOutputBlock
  | AudioOutputBlock
  | DocumentEditOutputBlock
  | CodeOutputBlock
  | ErrorOutputBlock
  | TableOutputBlock
  | CitationOutputBlock
  | RawOutputBlock;

/* ------------------------------------------------------------------ */
/* Compatibility renderer contract                                     */
/* ------------------------------------------------------------------ */

/**
 * Any UI renderer must implement this interface.
 * Unknown block types must produce a RawOutputBlock, never throw.
 */
export function normalizeOutputBlock(raw: unknown): AgentOutputBlock {
  if (!raw || typeof raw !== 'object') {
    return { type: 'error', error: 'Output block is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  const knownTypes = new Set([
    'text',
    'json',
    'image',
    'video',
    'audio',
    'document-edit',
    'code',
    'error',
    'table',
    'citation',
    'raw',
  ]);
  if (typeof obj.type === 'string' && knownTypes.has(obj.type)) {
    return obj as unknown as AgentOutputBlock;
  }
  // Forward-compat: wrap in raw block
  return {
    type: 'raw',
    originalType: typeof obj.type === 'string' ? obj.type : 'unknown',
    data: raw,
  };
}
