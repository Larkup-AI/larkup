export type VideoEvidenceVerificationStatus =
  'supported' | 'conflicted' | 'insufficient' | 'needs_inspection';

export interface IndexedVideoAnswerSignal {
  modality: string;
  text: string;
  confidenceScore: number;
  startSecs: number;
  endSecs: number;
  conflict?: boolean;
}

// Concise inventory records average well under a paragraph. This ceiling is
// high enough for long recordings while still bounding the answer model's
// context and the browser payload.
export const MAX_EXHAUSTIVE_EVIDENCE_ITEMS = 800;
// Structured inventories are rendered by the browser's paginated data table,
// never supplied to the answer model. They therefore deserve a much higher
// transport limit than prose evidence while still protecting a chat response
// from an unbounded malformed source.
export const MAX_EXHAUSTIVE_TABLE_ROWS = 10_000;

/** Follow a tool-owned chronological cursor without relying on model tool use. */
export async function collectExhaustiveVideoEvidencePages(
  execute: (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<unknown>,
  input: { mediaAssetId: string; query: string },
  firstPage: unknown,
  toolCallId: string,
) {
  if (!firstPage || typeof firstPage !== 'object' || Array.isArray(firstPage)) return firstPage;
  const first = firstPage as Record<string, any>;
  if (first.continuation?.exhaustive !== true || first.continuation?.hasMore !== true) {
    return firstPage;
  }

  const evidence = Array.isArray(first.evidence) ? [...first.evidence] : [];
  const seen = new Set(evidence.map((item: any) => item?.id ?? item?.evidenceId).filter(Boolean));
  const rows = Array.isArray(first.rows) ? [...first.rows] : [];
  const seenRows = new Set(
    rows.map((row: any) => row?.id ?? row?._rowId).filter((id: unknown) => id != null),
  );
  const hasTable = Array.isArray(first.rows);
  let continuation = first.continuation;
  let lastPage = first;

  while (
    continuation?.hasMore === true &&
    Number.isFinite(continuation.nextCursor) &&
    (hasTable
      ? rows.length < MAX_EXHAUSTIVE_TABLE_ROWS
      : evidence.length < MAX_EXHAUSTIVE_EVIDENCE_ITEMS)
  ) {
    const cursor = Number(continuation.nextCursor);
    const next = await execute({ ...input, exhaustive: true, cursor, limit: 48 }, { toolCallId });
    if (!next || typeof next !== 'object' || Array.isArray(next)) break;
    const page = next as Record<string, any>;
    for (const item of Array.isArray(page.evidence) ? page.evidence : []) {
      const id = item?.id ?? item?.evidenceId;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      evidence.push(item);
      if (evidence.length >= MAX_EXHAUSTIVE_EVIDENCE_ITEMS) break;
    }
    if (hasTable) {
      for (const row of Array.isArray(page.rows) ? page.rows : []) {
        const id = row?.id ?? row?._rowId;
        if (id != null && seenRows.has(id)) continue;
        if (id != null) seenRows.add(id);
        rows.push(row);
        if (rows.length >= MAX_EXHAUSTIVE_TABLE_ROWS) break;
      }
    }
    lastPage = page;
    continuation = page.continuation;
    if (!continuation || Number(continuation.nextCursor) <= cursor) break;
  }

  return {
    ...first,
    evidence,
    ...(hasTable
      ? {
          columns: Array.isArray(first.columns) ? first.columns : [],
          rows,
          totalRows: rows.length,
        }
      : {}),
    continuation: {
      ...(lastPage.continuation ?? continuation ?? first.continuation),
      aggregatedItems: hasTable ? rows.length : evidence.length,
      contextLimitReached:
        (hasTable
          ? rows.length >= MAX_EXHAUSTIVE_TABLE_ROWS
          : evidence.length >= MAX_EXHAUSTIVE_EVIDENCE_ITEMS) && continuation?.hasMore === true,
    },
  };
}

/**
 * Decide whether chat can answer from the immutable index before paying for a
 * live source read. This gate is intentionally content-agnostic: it evaluates
 * provenance, confidence, temporal coverage, and retrieval agreement rather
 * than recognizing any particular kind of recording.
 */
export function indexedVideoEvidenceIsSufficient(input: {
  verificationStatus: VideoEvidenceVerificationStatus;
  questionKinds: string[];
  evidence: IndexedVideoAnswerSignal[];
  focusSources?: string[];
  durationSecs?: number;
  hierarchyRanges?: number;
}) {
  if (input.verificationStatus !== 'supported') return false;
  const usable = input.evidence.filter(
    (item) => !item.conflict && item.confidenceScore >= 0.5 && item.text.trim().length > 0,
  );
  if (usable.some((item) => /Claim verdict:\s*direct/i.test(item.text))) return true;

  const descriptive = usable.filter((item) => ['visual', 'computed'].includes(item.modality));
  const nonLexicalAgreement = (input.focusSources ?? []).some((source) => source !== 'lexical');

  // A reconciled computed account is created from timestamped source evidence,
  // not a remembered answer. It is the index's strongest reusable result.
  if (descriptive.some((item) => item.modality === 'computed')) return true;

  if (input.questionKinds.includes('state-change') || input.questionKinds.includes('outcome')) {
    const duration = input.durationSecs;
    const moments = new Set(descriptive.map((item) => Math.floor(item.startSecs / 15))).size;
    const buckets = duration && duration > 0 ? 5 : 1;
    const coveredBuckets = new Set(
      descriptive.map((item) =>
        duration && duration > 0
          ? Math.min(buckets - 1, Math.floor((item.startSecs / duration) * buckets))
          : 0,
      ),
    ).size;

    // For outcome questions, if we have broad temporal coverage of the video,
    // the index is sufficient without needing to rewatch the final 10 seconds blindly.
    if (moments >= 3 && coveredBuckets / buckets >= 0.6 && (input.hierarchyRanges ?? 0) > 0) {
      return true;
    }
  }

  // A semantically located visual account can answer a focused appearance,
  // comparison, count, or outcome question immediately. OCR/transcript-only
  // neighbours do not pass this gate and therefore still trigger a close read.
  return descriptive.length > 0 && nonLexicalAgreement;
}
