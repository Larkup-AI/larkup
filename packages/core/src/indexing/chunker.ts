import type { ChunkingParams, SourceDocument } from "../types"

/**
 * Document chunking for the indexing pipeline.
 *
 * Chunk sizes in the config are expressed in *tokens*; we approximate with a
 * chars-per-token ratio so the toolkit stays dependency-free (no tokenizer
 * needed). ~4 chars/token is a good rule of thumb for English text. The same
 * params drive the generated server later, so behaviour stays consistent.
 */

const CHARS_PER_TOKEN = 4

export interface Chunk {
  /** stable id: `${documentId}#${index}` */
  id: string
  documentId: string
  /** position of this chunk within its document */
  index: number
  text: string
  /** carried onto the vector record for citations in the demo */
  title: string
  url?: string
  source: string
  charCount: number
  metadata?: Record<string, any>
}

function tokensToChars(tokens: number) {
  return Math.max(1, Math.round(tokens * CHARS_PER_TOKEN))
}

/** Split on paragraph / sentence boundaries, largest-first, for "recursive". */
const RECURSIVE_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", " "]

function splitRecursive(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  for (const sep of RECURSIVE_SEPARATORS) {
    if (!text.includes(sep)) continue
    const parts = text.split(sep)
    const out: string[] = []
    let buf = ""
    for (const part of parts) {
      const piece = buf ? buf + sep + part : part
      if (piece.length <= maxChars) {
        buf = piece
      } else {
        if (buf) out.push(buf)
        // a single part can still exceed maxChars → recurse with next separator
        if (part.length > maxChars) out.push(...splitRecursive(part, maxChars))
        else buf = part
      }
    }
    if (buf) out.push(buf)
    if (out.length > 1) return out
  }
  // No separators helped — hard slice.
  return hardSlice(text, maxChars)
}

function splitSentences(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [text]
  const out: string[] = []
  let buf = ""
  for (const s of sentences) {
    const piece = buf + s
    if (piece.length <= maxChars) buf = piece
    else {
      if (buf) out.push(buf.trim())
      buf = s.length > maxChars ? "" : s
      if (s.length > maxChars) out.push(...hardSlice(s, maxChars))
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function hardSlice(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars))
  }
  return out
}

/** Re-introduce overlap between adjacent chunks (in chars). */
function applyOverlap(chunks: string[], overlapChars: number): string[] {
  if (overlapChars <= 0 || chunks.length <= 1) return chunks
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk
    const tail = chunks[i - 1].slice(-overlapChars)
    return `${tail} ${chunk}`.trim()
  })
}

/** Chunk a single document into overlapping text windows. */
export function chunkDocument(
  doc: SourceDocument,
  params: ChunkingParams,
): Chunk[] {
  const maxChars = tokensToChars(params.chunkSize)
  const overlapChars = tokensToChars(params.chunkOverlap)
  const text = doc.content.trim()
  if (!text) return []

  let raw: string[]
  switch (params.strategy) {
    case "sentence":
      raw = splitSentences(text, maxChars)
      break
    case "fixed":
      raw = hardSlice(text, maxChars)
      break
    case "recursive":
    default:
      raw = splitRecursive(text, maxChars)
      break
  }

  const withOverlap = applyOverlap(
    raw.map((c) => c.trim()).filter(Boolean),
    overlapChars,
  )

  return withOverlap.map((textChunk, index) => ({
    id: `${doc.id}#${index}`,
    documentId: doc.id,
    index,
    text: textChunk,
    title: doc.title,
    url: doc.url,
    source: doc.source,
    charCount: textChunk.length,
    metadata: doc.metadata,
  }))
}

/** Chunk an entire corpus. */
export function chunkCorpus(
  docs: SourceDocument[],
  params: ChunkingParams,
): Chunk[] {
  return docs.flatMap((d) => chunkDocument(d, params))
}
