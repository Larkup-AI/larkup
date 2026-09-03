import { planVideoQuestion } from '@larkup/core/video-knowledge/query-planner';

type ToolResultPart = {
  type?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

/**
 * Interpret the generic media-evidence verification protocol.
 *
 * `directlyEstablished` describes whether one observation states the answer.
 * It is deliberately false for an answer established by a chronological trail,
 * which is still answer-level evidence and must not be downgraded to a refusal.
 */
export function mediaClaimNeedsCorroboration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const verification = value as {
    status?: unknown;
    directlyEstablished?: unknown;
    requiresCorroboration?: unknown;
  };
  if (verification.status === 'needs-corroboration') return true;
  if (
    verification.status === 'directly-established' ||
    verification.status === 'established-by-trail'
  ) {
    return false;
  }
  if (typeof verification.requiresCorroboration === 'boolean') {
    return verification.requiresCorroboration;
  }
  // Backward compatibility for evidence providers that predate `status`.
  return verification.directlyEstablished === false;
}

/** True when the evidence provider says the claim can be answered now. */
export function mediaClaimIsAnswerLevel(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const verification = value as {
    status?: unknown;
    directlyEstablished?: unknown;
    requiresCorroboration?: unknown;
  };
  if (
    verification.status === 'directly-established' ||
    verification.status === 'established-by-trail'
  ) {
    return true;
  }
  if (verification.status === 'needs-corroboration') return false;
  if (verification.requiresCorroboration === true) return false;
  return verification.directlyEstablished === true;
}

/** Find an answer-level media claim even when it is nested in a search result. */
export function containsAnswerLevelMediaEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return containsAnswerLevelMediaEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsAnswerLevelMediaEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (
    record.success === true &&
    mediaClaimIsAnswerLevel(record.claimVerification) &&
    (Array.isArray(record.evidence) || record.directObservation !== undefined)
  ) {
    return true;
  }
  return Object.values(record).some(containsAnswerLevelMediaEvidence);
}

function questionSimilarity(left: string, right: string) {
  const terms = (value: string) =>
    new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{Letter}\p{Number}]+/gu) ?? [],
    );
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const weight = (values: Set<string>) =>
    [...values].reduce((total, term) => total + term.length, 0);
  const shared = new Set([...leftTerms].filter((term) => rightTerms.has(term)));
  return weight(shared) / Math.max(weight(leftTerms), weight(rightTerms));
}

/** Extract only direct claims verified for the current question. */
export function collectQuestionMatchedDirectClaims(value: unknown, question: string): string[] {
  const claims = new Set<string>();
  const inspectText = (text: string) => {
    for (const block of text.split(/(?=Claim question:)/gi)) {
      const claimedQuestion = block.match(/Claim question:\s*([^\n]+)/i)?.[1]?.trim();
      const answer = block.match(/Claim answer:\s*([^\n]+)/i)?.[1]?.trim();
      if (
        claimedQuestion &&
        answer &&
        /Claim verdict:\s*direct/i.test(block) &&
        questionSimilarity(claimedQuestion, question) >= 0.55
      ) {
        claims.add(answer);
      }
    }
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') return inspectText(candidate);
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (candidate && typeof candidate === 'object') Object.values(candidate).forEach(visit);
  };
  visit(value);
  return [...claims].slice(0, 8);
}

/**
 * Last-resort visible text when a provider closes after tools without writing
 * its answer. Only answer-level media results qualify; locators and
 * needs-corroboration results must never be turned into claims here.
 */
export function collectAnswerLevelMediaStatements(value: unknown): string[] {
  const statements: string[] = [];
  const seen = new Set<string>();
  let exhaustive = false;
  const textOf = (payload: unknown) => {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* ordinary text is not a verified media result */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (
      record.continuation &&
      typeof record.continuation === 'object' &&
      (record.continuation as { exhaustive?: unknown }).exhaustive === true
    ) {
      exhaustive = true;
    }
    if (
      record.success === true &&
      mediaClaimIsAnswerLevel(record.claimVerification) &&
      Array.isArray(record.evidence)
    ) {
      for (const item of record.evidence as Array<{ payload?: unknown }>) {
        const statement = textOf(item?.payload)
          .split(/\nClaim question:/i, 1)[0]
          .replace(/^(?:Reconciled|Indexed)\s+(?:state|event|context|overview):\s*/i, '')
          .trim()
          .slice(0, 700);
        const key = statement.normalize('NFKC').toLocaleLowerCase();
        if (!statement || seen.has(key)) continue;
        seen.add(key);
        statements.push(statement);
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return exhaustive ? statements.slice(0, 2_000) : statements.slice(-8);
}

/** Render a final two-sided numeric outcome without waiting on a slow prose model. */
export function formatOutcomeMediaAnswer(value: unknown, question: string): string | undefined {
  if (!planVideoQuestion(question).kinds.includes('outcome')) return undefined;
  type Reading = { at: number; text: string };
  const readings: Reading[] = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified evidence qualifies */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success === true && mediaClaimIsAnswerLevel(record.claimVerification)) {
      const temporal = record.temporalContext as { readings?: unknown } | undefined;
      if (Array.isArray(temporal?.readings)) {
        for (const item of temporal.readings) {
          if (!item || typeof item !== 'object') continue;
          const reading = item as { atSecs?: unknown; text?: unknown };
          if (typeof reading.text !== 'string') continue;
          readings.push({ at: Number(reading.atSecs ?? 0), text: reading.text });
        }
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);

  const pairPattern =
    /([^=,;،؛\n]{2,100}?)(?:\s*=\s*|\s*:\s*|\s+)(-?\d+(?:[.,]\d+)?)(?=$|[,;،؛])/gu;
  const candidates = readings
    .sort((left, right) => left.at - right.at)
    .map((reading) => {
      const pairs = [...reading.text.matchAll(pairPattern)].map((match) => ({
        label: (match[1] ?? '')
          .replace(/^.*?(?:(?:final\s+)?(?:result|score)|النتيجة(?:\s+النهائية)?)\s*:\s*/iu, '')
          .replace(/^(?:Reconciled|Indexed)\s+state:\s*/i, '')
          .replace(/^(?:(?:final\s+)?(?:result|score)|النتيجة(?:\s+النهائية)?)\s*/iu, '')
          .trim(),
        value: Number((match[2] ?? '').replace(',', '.')),
      }));
      return {
        ...reading,
        pairs: pairs.filter((pair) => pair.label && Number.isFinite(pair.value)),
      };
    })
    .filter((reading) => reading.pairs.length === 2);
  const settled = candidates.at(-1);
  if (!settled) return undefined;
  const [left, right] = settled.pairs;
  const mostlyArabic =
    /\p{Script=Arabic}/u.test(question) &&
    !/\b(?:who|which|won|winner|score|result|match)\b/i.test(question);
  if (left.value === right.value) {
    return mostlyArabic
      ? `انتهت بالتعادل ${left.value}–${right.value}.`
      : `It ended level at ${left.value}–${right.value}.`;
  }
  const winner = left.value > right.value ? left : right;
  const runnerUp = winner === left ? right : left;
  return mostlyArabic
    ? `فاز ${winner.label} بنتيجة ${winner.value} مقابل ${runnerUp.value} لـ${runnerUp.label}.`
    : `${winner.label} won, ${winner.value}–${runnerUp.value} over ${runnerUp.label}.`;
}

/** Use the strongest bounded source reading directly when it already settled the question. */
export function formatDirectObservationAnswer(value: unknown, question = ''): string | undefined {
  const readings: Array<{ found: string; confidence: string; at: string }> = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified evidence qualifies */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success === true && mediaClaimIsAnswerLevel(record.claimVerification)) {
      const direct = record.directObservation as { readings?: unknown } | undefined;
      if (Array.isArray(direct?.readings)) {
        for (const item of direct.readings) {
          if (!item || typeof item !== 'object') continue;
          const reading = item as {
            found?: unknown;
            confidence?: unknown;
            at?: unknown;
            settlesQuestion?: unknown;
            coverageComplete?: unknown;
          };
          if (typeof reading.found !== 'string' || !reading.found.trim()) continue;
          if (reading.settlesQuestion === false) continue;
          if (reading.coverageComplete === false) continue;
          readings.push({
            found: reading.found.trim(),
            confidence: String(reading.confidence ?? ''),
            at: String(reading.at ?? ''),
          });
        }
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  const asksForGroupAppearance =
    /\b(?:each|every|all|both)\b[\s\S]{0,50}\b(?:wear|wearing|wore|dressed|clothes|clothing|outfit|appearance)\b|\b(?:wear|wearing|wore|dressed|clothes|clothing|outfit|appearance)\b[\s\S]{0,50}\b(?:each|every|all|both)\b/i.test(
      question,
    );
  const best = readings.sort(
    (left, right) =>
      (asksForGroupAppearance
        ? Number(/@[\w.-]+/.test(left.found)) - Number(/@[\w.-]+/.test(right.found))
        : 0) ||
      Number(right.confidence === 'high') - Number(left.confidence === 'high') ||
      Math.min(right.found.length, 600) - Math.min(left.found.length, 600),
  )[0];
  if (!best) return undefined;
  if (!asksForGroupAppearance) return best.found;
  return best.found
    .replace(/\s*\([^)]*@[\w.-]+[^)]*\)/g, '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/@[\w.-]+/.test(sentence))
    .join(' ')
    .trim();
}

function displayTimecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Render a verified complete media inventory without putting hundreds of
 * already-final source items through another model context window.
 */
export function formatExhaustiveMediaAnswer(value: unknown, question: string): string | undefined {
  type Item = { at: number; text: string; sourceInventory: boolean };
  let complete: Item[] | undefined;
  const textOf = (payload: unknown) => {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  };
  const clean = (raw: string) => {
    const sourceLine = raw
      .split(/\n(?=(?:Context|Answer|Claim question|Claim verdict|Claim answer):)/i, 1)[0]
      .replace(/^(?:Reconciled|Indexed)\s+(?:state|event|context|overview):\s*/i, '')
      .replace(/^(?:Source (?:question|item)(?:\s*\([^)]*\))?|Question):\s*/i, '')
      .trim();
    return sourceLine;
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified evidence qualifies */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    const continuation = record.continuation as
      { exhaustive?: unknown; hasMore?: unknown } | undefined;
    if (
      record.success === true &&
      continuation?.exhaustive === true &&
      continuation.hasMore !== true &&
      mediaClaimIsAnswerLevel(record.claimVerification) &&
      Array.isArray(record.evidence)
    ) {
      complete = (record.evidence as Array<Record<string, unknown>>)
        .map((item) => {
          const range = (item.timeRange ?? {}) as { startSecs?: unknown };
          const at = Number(range.startSecs ?? item.startSecs ?? 0);
          const raw = textOf(item.payload);
          return {
            at: Number.isFinite(at) ? at : 0,
            text: clean(raw),
            sourceInventory: /^(?:Source (?:question|item)(?:\s*\([^)]*\))?|Question):/i.test(
              raw.trim(),
            ),
          };
        })
        .filter((item) => item.text)
        .sort((left, right) => left.at - right.at);
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  if (!complete || complete.length === 0) return undefined;
  const seen = new Set<string>();
  const items = complete.filter((item) => {
    const key = `${Math.floor(item.at)}:${item.text.normalize('NFKC').toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Small ordinary inventories (a roster or a handful of states) benefit from
  // natural synthesis. Source-authored inventory records are already the exact
  // requested units, and a large result must avoid another context window.
  if (items.length <= 48 && !items.every((item) => item.sourceInventory)) return undefined;
  const intro = /\p{Script=Arabic}/u.test(question)
    ? 'دي القائمة الكاملة بالترتيب الزمني:'
    : 'Here is the complete list in chronological order:';
  return `${intro}\n\n${items
    .map((item) => `- [${displayTimecode(item.at)}] ${item.text}`)
    .join('\n')}`;
}

/**
 * Guarantee that a provider stream ends with visible answer text.
 *
 * Tool-backed reasoning models can terminate with a normal finish, an error,
 * an abort, or simply close the stream without emitting a final text part.
 * Buffering finish-step lets the fallback text stay inside the final step.
 */
export function ensureNonEmptyTextStream(fallbackText: string) {
  const fallback =
    fallbackText.trim() ||
    'I found the relevant source, but the answer could not be completed. Please try again.';

  return () => {
    let currentStepHasText = false;
    let fallbackEmitted = false;
    let pendingFinishStep: any;

    const emitFallback = (controller: TransformStreamDefaultController<any>) => {
      if (currentStepHasText || fallbackEmitted) return;
      const id = `answer-${crypto.randomUUID()}`;
      controller.enqueue({ type: 'text-start', id });
      controller.enqueue({ type: 'text-delta', id, text: fallback });
      controller.enqueue({ type: 'text-end', id });
      currentStepHasText = true;
      fallbackEmitted = true;
    };

    const emitPendingFinishStep = (controller: TransformStreamDefaultController<any>) => {
      if (pendingFinishStep) controller.enqueue(pendingFinishStep);
      pendingFinishStep = undefined;
    };

    return new TransformStream<any, any>({
      transform(chunk, controller) {
        if (chunk.type === 'finish-step') {
          pendingFinishStep = chunk;
          return;
        }
        if (chunk.type === 'start-step') {
          emitPendingFinishStep(controller);
          currentStepHasText = false;
          controller.enqueue(chunk);
          return;
        }
        if (chunk.type === 'text-delta' && chunk.text?.trim()) currentStepHasText = true;
        if (chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort') {
          emitFallback(controller);
          emitPendingFinishStep(controller);
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        emitFallback(controller);
        emitPendingFinishStep(controller);
      },
    });
  };
}

function compactMediaEvidence(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = value as Record<string, any>;
  if (typeof result.mediaAssetId !== 'string' || !Array.isArray(result.evidence)) return value;
  const exhaustive = result.continuation?.exhaustive === true;
  const evidenceLimit = exhaustive ? 240 : 48;
  const payloadLimit = exhaustive ? 260 : 700;
  return {
    success: result.success,
    mediaAssetId: result.mediaAssetId,
    fileName: result.fileName,
    supportingClip: result.supportingClip,
    claimVerification: result.claimVerification,
    investigation: result.investigation,
    continuation: result.continuation,
    directObservation: result.directObservation
      ? {
          rule: result.directObservation.rule,
          readings: Array.isArray(result.directObservation.readings)
            ? result.directObservation.readings.slice(0, 12).map((reading: any) => ({
                range: reading.range,
                at: reading.at,
                found: reading.found,
                read: Array.isArray(reading.read) ? reading.read.slice(0, 12) : reading.read,
                confidence: reading.confidence,
              }))
            : [],
        }
      : undefined,
    temporalContext: result.temporalContext
      ? {
          rule: result.temporalContext.rule,
          readings: Array.isArray(result.temporalContext.readings)
            ? result.temporalContext.readings.slice(-48)
            : [],
        }
      : undefined,
    evidence: result.evidence.slice(0, evidenceLimit).map((item: any) => ({
      id: item.id ?? item.evidenceId,
      modality: item.modality,
      timeRange: item.timeRange ?? {
        startSecs: item.startSecs,
        endSecs: item.endSecs,
        precision: item.precision,
      },
      payload:
        typeof item.payload === 'string'
          ? item.payload.slice(0, payloadLimit)
          : (item.payload ??
            (typeof item.text === 'string' ? item.text.slice(0, payloadLimit) : item.text)),
      confidence: item.confidence,
      conflicted: item.conflicted,
    })),
  };
}

function compactValue(value: unknown, toolName?: string): unknown {
  const jsonValue =
    typeof value === 'object' && value !== null && (value as { type?: string }).type === 'json'
      ? (value as { value?: unknown }).value
      : value;
  const isJsonEnvelope = jsonValue !== value;
  const parsed = typeof jsonValue === 'string' ? tryParse(jsonValue) : jsonValue;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;

  const result = parsed as Record<string, any>;
  let compact: Record<string, any> | undefined;
  if (toolName === 'searchKnowledgeBase' && Array.isArray(result.hits)) {
    compact = {
      query: result.query,
      hits: result.hits.slice(0, 4).map((hit: any) => ({
        documentId: hit.documentId,
        title: hit.title,
        url: hit.url,
        score: hit.score,
        text: typeof hit.text === 'string' ? hit.text.slice(0, 1_200) : hit.text,
        images: Array.isArray(hit.images)
          ? hit.images.slice(0, 4).map((image: any) => ({
              imageUrl: image.imageUrl,
              pageNumber: image.pageNumber,
              index: image.index,
            }))
          : undefined,
        metadata: hit.metadata
          ? {
              mediaAssetId: hit.metadata.mediaAssetId,
              pageNumber: hit.metadata.pageNumber,
              contentKind: hit.metadata.contentKind,
            }
          : undefined,
      })),
      // The evidence-first shortcut embeds a completed video investigation
      // directly on the search result (see searchKnowledgeBase's execute()
      // in chat/tools.ts) so a model that stops after one tool call still
      // has what it needs. Dropping it here left the model with nothing to
      // answer from on the next step -- observed live as a completely empty
      // final response despite the video having been found correctly.
      ...(result.videoEvidence !== undefined
        ? { videoEvidence: compactMediaEvidence(result.videoEvidence) }
        : {}),
    };
  } else if (typeof result.mediaAssetId === 'string' && Array.isArray(result.evidence)) {
    compact = compactMediaEvidence(result) as Record<string, any>;
  } else if (toolName === 'queryTabularData' && Array.isArray(result.rows)) {
    compact = {
      columns: result.columns,
      rows: result.rows.slice(0, 50),
      totalRows: result.totalRows,
      aggregationResults: result.aggregationResults,
    };
  } else if (toolName === 'executeAnalysis') {
    compact = {
      stdout: typeof result.stdout === 'string' ? result.stdout.slice(0, 4_000) : result.stdout,
      stderr: typeof result.stderr === 'string' ? result.stderr.slice(0, 1_000) : result.stderr,
      exitCode: result.exitCode,
    };
  } else if (
    (toolName === 'inspectPdfPages' || toolName === 'analyzePdfPages') &&
    Array.isArray(result.pages)
  ) {
    compact = {
      success: result.success,
      documentId: result.documentId,
      title: result.title,
      totalPages: result.totalPages,
      pages: result.pages.slice(0, 3).map((page: any) => ({
        pageNumber: page.pageNumber,
        text: typeof page.text === 'string' ? page.text.slice(0, 1_600) : undefined,
        tables: Array.isArray(page.tables) ? page.tables.slice(0, 2) : undefined,
        analysis: typeof page.analysis === 'string' ? page.analysis.slice(0, 3_000) : undefined,
        previewUrl: page.previewUrl,
      })),
    };
  }

  if (!compact) return value;
  const serialized = typeof jsonValue === 'string' ? JSON.stringify(compact) : compact;
  return isJsonEnvelope ? { ...(value as Record<string, unknown>), value: serialized } : serialized;
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Removing every tool for the final answer step (activeTools: [],
 * toolChoice: 'none') isn't always enough signal on its own -- observed
 * live with a reasoning-tagged model (Claude Sonnet 4.6) on a large,
 * evidence-heavy video investigation: it burned a few output tokens and
 * finished with no tool call and no text at all, leaving the turn looking
 * answered (citations rendered from the tool result) but silently empty.
 * An explicit nudge naming the moment ("you have every tool result now,
 * answer") reliably produced a real answer where the bare absence of tools
 * didn't -- reproduced and confirmed live before and after this fix.
 */
export function withFinalAnswerNudge(messages: readonly any[]): any[] {
  return [
    ...messages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'You have every tool result gathered above. Answer the original question now, directly, using that evidence -- do not call another tool.',
        },
      ],
    },
  ];
}

/** Keep rendered tool outputs intact while bounding the next model call's evidence. */
export function compactToolContextForModel(messages: readonly any[]): any[] {
  return messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((part: ToolResultPart) => {
        if (part.type !== 'tool-result') return part;
        if ('output' in part) {
          return { ...part, output: compactValue(part.output, part.toolName) };
        }
        if ('result' in part) {
          return { ...part, result: compactValue(part.result, part.toolName) };
        }
        return part;
      }),
    };
  });
}
