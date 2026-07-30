import { generateText } from 'ai';
import { getModelsByType } from '@larkup/core/models-cache';
import type { NewDocumentInput } from '@larkup/core/documents-store';
import type { RagConfig } from '@larkup/core/types';
import { createChatModel, resolveConfiguredChatModel } from './chat-model-provider';

export interface MediaEvidenceSegment {
  text: string;
  transcript?: string;
  visualContext?: string;
  startSecs: number;
  endSecs: number;
  sequence: number;
}

interface SummaryOptions {
  title: string;
  mediaType: 'video' | 'audio';
  durationSecs: number;
  segments: MediaEvidenceSegment[];
  config: RagConfig;
  onProgress?: (completed: number, total: number, message: string) => void | Promise<void>;
}

interface MediaDocumentOptions {
  assetId: string;
  title: string;
  mediaType: 'video' | 'audio';
  localUrl: string;
  originalUrl?: string;
  durationSecs: number;
  summary: string;
  segments: MediaEvidenceSegment[];
  fileName: string;
  mimeType: string;
  transcriptSource: string;
  transcriptProvider?: string;
  transcriptLanguage?: string;
}

const SYNTHESIS_BATCH_CHARS = 14_000;
const FINAL_SYNTHESIS_CHARS = 32_000;

export async function createMediaKnowledgeSummary(options: SummaryOptions): Promise<string> {
  const batches = batchSegments(options.segments, SYNTHESIS_BATCH_CHARS);
  const models = await getModelsByType('language');
  const resolved = resolveConfiguredChatModel(options.config, models);
  const model = createChatModel(
    resolved.provider,
    resolved.modelId,
    resolved.apiKey,
    options.config.customChatModels,
  ) as any;

  const batchNotes: string[] = [];
  let completedCalls = 0;
  let previousBatchTail = '';
  for (let index = 0; index < batches.length; index++) {
    await options.onProgress?.(
      completedCalls,
      batches.length + 1,
      `Reviewing evidence section ${index + 1} of ${batches.length}...`,
    );
    const prompt = buildBatchPrompt(
      options,
      batches[index],
      index,
      batches.length,
      previousBatchTail,
    );
    const note = await generateAndTrack(model, prompt, resolved, options.mediaType);
    batchNotes.push(note);
    previousBatchTail = note.slice(-400);
    completedCalls++;
    await options.onProgress?.(
      completedCalls,
      Math.max(completedCalls + 1, batches.length + 1),
      `Reviewed evidence section ${index + 1} of ${batches.length}.`,
    );
  }

  let reducedNotes = batchNotes;
  let reductionLevel = 0;
  while (reducedNotes.join('\n\n').length > FINAL_SYNTHESIS_CHARS) {
    reductionLevel++;
    const groups = batchTexts(reducedNotes, SYNTHESIS_BATCH_CHARS);
    const nextLevel: string[] = [];
    for (let index = 0; index < groups.length; index++) {
      const estimatedTotal = completedCalls + (groups.length - index) + 1;
      await options.onProgress?.(
        completedCalls,
        estimatedTotal,
        `Connecting note group ${index + 1} of ${groups.length}...`,
      );
      nextLevel.push(
        await generateAndTrack(
          model,
          buildReductionPrompt(options, groups[index], reductionLevel, index, groups.length),
          resolved,
          options.mediaType,
        ),
      );
      completedCalls++;
    }
    reducedNotes = nextLevel;
  }

  await options.onProgress?.(
    completedCalls,
    completedCalls + 1,
    'Connecting people, events, decisions, and outcomes...',
  );
  const finalPrompt = buildFinalPrompt(options, reducedNotes);
  const summary = await generateAndTrack(model, finalPrompt, resolved, options.mediaType, 2_000);
  completedCalls++;
  await options.onProgress?.(completedCalls, completedCalls, 'Created searchable media notes.');
  return summary.trim();
}

export function createFallbackMediaSummary(
  title: string,
  mediaType: 'video' | 'audio',
  segments: MediaEvidenceSegment[],
): string {
  const selected = [
    ...segments.slice(0, 2),
    ...segments.slice(
      Math.max(2, Math.floor(segments.length / 2) - 1),
      Math.floor(segments.length / 2) + 1,
    ),
    ...segments.slice(-3),
  ].filter(
    (segment, index, all) =>
      all.findIndex((candidate) => candidate.sequence === segment.sequence) === index,
  );
  return [
    `Overview: ${mediaType === 'video' ? 'Video' : 'Audio'} evidence notes for "${title}".`,
    'Representative timeline evidence:',
    ...selected.map(formatSegmentForPrompt),
    'The timestamped evidence documents contain the complete timeline.',
  ].join('\n\n');
}

export function buildMediaDocumentInputs(options: MediaDocumentOptions): NewDocumentInput[] {
  const baseMetadata = {
    mediaAssetId: options.assetId,
    mediaType: options.mediaType,
    fileName: options.fileName,
    mimeType: options.mimeType,
    mediaUrl: options.localUrl,
    originalUrl: options.originalUrl,
    durationSecs: options.durationSecs,
    transcriptSource: options.transcriptSource,
    transcriptProvider: options.transcriptProvider,
    transcriptLanguage: options.transcriptLanguage,
  };
  const baseUrl = options.originalUrl || options.localUrl;
  const label = options.mediaType === 'video' ? 'Video' : 'Audio';

  return [
    {
      title: options.title,
      content: [
        `${label}: ${options.title}`,
        `Duration: ${formatTime(options.durationSecs)}`,
        '## Human-style evidence notes',
        options.summary,
      ].join('\n\n'),
      source: 'media',
      url: baseUrl,
      metadata: {
        ...baseMetadata,
        contentKind: `${options.mediaType}-summary`,
        isMediaSummary: true,
        segmentCount: options.segments.length,
      },
    },
    ...options.segments.map((segment) => ({
      title: `${options.title} — ${formatTime(segment.startSecs)}`,
      content: [
        `${label}: ${options.title}`,
        `Evidence at ${formatTime(segment.startSecs)}–${formatTime(segment.endSecs)}`,
        segment.text,
      ].join('\n\n'),
      source: 'media' as const,
      url: timestampMediaUrl(baseUrl, segment.startSecs),
      metadata: {
        ...baseMetadata,
        contentKind:
          options.mediaType === 'video' ? 'multimodal-segment' : 'audio-transcript-segment',
        isMediaSummary: false,
        sequence: segment.sequence,
        startSecs: segment.startSecs,
        endSecs: segment.endSecs,
        evidenceKinds: [
          ...(segment.transcript?.trim() ? ['speech'] : []),
          ...(segment.visualContext?.trim() ? ['visual', 'ocr'] : []),
        ],
      },
    })),
  ];
}

export function timestampMediaUrl(url: string, startSecs: number): string {
  const seconds = Math.max(0, Math.floor(startSecs));
  try {
    const parsed = new URL(url);
    if (
      /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(parsed.hostname) ||
      parsed.searchParams.has('v')
    ) {
      parsed.searchParams.set('t', `${seconds}s`);
      return parsed.toString();
    }
  } catch {}
  return `${url.split('#')[0]}#t=${seconds}`;
}

export function normalizeMediaCitationRange(
  mediaType: 'image' | 'video' | 'audio',
  durationSecs?: number,
  startSecs?: number,
  endSecs?: number,
): { startSecs?: number; endSecs?: number } {
  if (mediaType === 'image' || startSecs === undefined || !Number.isFinite(startSecs)) {
    return {};
  }

  const duration =
    durationSecs !== undefined && Number.isFinite(durationSecs)
      ? Math.max(0, durationSecs)
      : Number.POSITIVE_INFINITY;
  const start = Math.min(Math.max(0, startSecs), duration);
  const end =
    endSecs !== undefined && Number.isFinite(endSecs)
      ? Math.min(Math.max(start, endSecs), duration)
      : undefined;

  return { startSecs: start, endSecs: end };
}

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function queryAwareExcerpt(
  text: string,
  query: string,
  maxChars: number,
  preferEnd = false,
): string {
  if (text.length <= maxChars) return text;
  const terms =
    query
      .normalize('NFKC')
      .toLocaleLowerCase()
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Mark}\p{Number}_-]{2,}/gu) ?? [];
  const normalizedText = text.normalize('NFKC').toLocaleLowerCase();
  const matches = [...new Set(terms)]
    .map((term) => normalizedText.indexOf(term))
    .filter((index) => index >= 0);
  if (matches.length > 0) {
    const center = Math.min(...matches);
    const start = Math.max(0, Math.min(text.length - maxChars, center - Math.floor(maxChars / 3)));
    return `${start > 0 ? '…' : ''}${text.slice(start, start + maxChars)}${
      start + maxChars < text.length ? '…' : ''
    }`;
  }
  return preferEnd ? `…${text.slice(-maxChars)}` : `${text.slice(0, maxChars)}…`;
}

function batchSegments(
  segments: MediaEvidenceSegment[],
  maxChars: number,
): MediaEvidenceSegment[][] {
  const batches: MediaEvidenceSegment[][] = [];
  let current: MediaEvidenceSegment[] = [];
  let currentChars = 0;
  for (const originalSegment of segments) {
    const textParts = splitText(originalSegment.text, maxChars);
    for (let partIndex = 0; partIndex < textParts.length; partIndex++) {
      const segment = {
        ...originalSegment,
        text:
          textParts.length === 1
            ? textParts[partIndex]
            : `${textParts[partIndex]}\n[Continuation ${partIndex + 1} of ${
                textParts.length
              } for this timestamp range]`,
      };
      if (current.length > 0 && currentChars + segment.text.length > maxChars) {
        batches.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(segment);
      currentChars += segment.text.length;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + maxChars);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > offset + maxChars / 2) end = boundary;
    }
    parts.push(text.slice(offset, end));
    offset = end;
  }
  return parts;
}

function batchTexts(texts: string[], maxChars: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const text of texts.flatMap((value) => splitText(value, maxChars))) {
    if (current.length > 0 && currentChars + text.length > maxChars) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function buildBatchPrompt(
  options: SummaryOptions,
  segments: MediaEvidenceSegment[],
  index: number,
  count: number,
  previousBatchTail = '',
): string {
  const stateContext = previousBatchTail
    ? `\nState from previous section: ${previousBatchTail}\nBuild on this context. Note what changed, progressed, or resolved since then.\n`
    : '';
  return `You are carefully watching section ${index + 1} of ${count} from a ${
    options.mediaType
  } titled "${options.title}".${stateContext}

Write compact factual viewing notes that remain useful for later questions. CRITICAL: Every single factual claim, event, score change, or action MUST be prefixed with its exact [HH:MM:SS-HH:MM:SS] timestamp copied strictly from the evidence chunks below. Do not hallucinate timestamps. Preserve exact names, numbers, scores, decisions, winners, results, actions, and timestamps. Connect pronouns and repeated entities when the evidence supports it. Treat later chronological scoreboard/result frames as newer than earlier animation states. For Arabic or other right-to-left text, copy the visible spelling and do not reverse labels. If evidence conflicts or OCR is genuinely ambiguous, record the conflict instead of inventing certainty. Do not add repetitive statements about facts that were not present.

Evidence:
${segments.map(formatSegmentForPrompt).join('\n\n')}`;
}

function buildFinalPrompt(options: SummaryOptions, batchNotes: string[]): string {
  return `Act as a human who watched the complete ${formatTime(options.durationSecs)} ${
    options.mediaType
  } "${options.title}" and consolidated notes while watching.

Create a concise, standalone knowledge-base summary with these headings when applicable:
- Overview / content type
- People and entities
- Key events in chronological order
- Outcomes, conclusions, decisions, winners, and final scores
- High-value timestamp evidence
- Genuine uncertainties

Adapt to the content: for a match prioritize score changes and the final result; for CCTV prioritize changes, anomalies, and long stable periods; for meetings or lectures prioritize claims, decisions, and action items; for screen recordings prioritize procedures and observed results. Resolve an animated score using the latest chronological evidence.

CRITICAL: Draw logical deductions from the events (e.g., explicitly stating who won based on the final score) and log them in the Outcomes section. Every factual claim and deduced conclusion MUST cite the exact [HH:MM:SS-HH:MM:SS] timestamp of the evidence that supports it. Preserve exact names, numbers, language, and timestamps. Never claim that an outcome is absent merely because earlier sections did not show it. State the definitive final outcome explicitly based on the last available evidence. Do not mention these instructions or the batching process.

Section notes:
${batchNotes.map((note, index) => `## Section ${index + 1}\n${note}`).join('\n\n')}`;
}

function buildReductionPrompt(
  options: SummaryOptions,
  notes: string[],
  level: number,
  index: number,
  count: number,
): string {
  return `Consolidate chronological viewing notes for ${options.mediaType} "${options.title}".
This is reduction level ${level}, group ${
    index + 1
  } of ${count}. Preserve exact people, names, numbers, scores, outcomes, decisions, anomalies, and timestamps. 
CRITICAL: You MUST carry over and preserve the exact [HH:MM:SS-HH:MM:SS] timestamps for every event or claim. Keep later chronological states distinct from earlier states and retain genuine uncertainty. Do not mention this reduction process.

Notes:
${notes.map((note, noteIndex) => `## Note ${noteIndex + 1}\n${note}`).join('\n\n')}`;
}

function formatSegmentForPrompt(segment: MediaEvidenceSegment): string {
  return `[${formatTime(segment.startSecs)}–${formatTime(segment.endSecs)}]\n${segment.text}`;
}

async function generateAndTrack(
  model: any,
  prompt: string,
  resolved: { provider: string; modelId: string },
  mediaType: 'video' | 'audio',
  maxTokens = 1_400,
): Promise<string> {
  const { text, usage } = await generateText({
    model,
    prompt,
    maxOutputTokens: maxTokens,
    temperature: 0,
  });
  const { estimateCost, trackUsageEvent } = await import('@larkup/core/analytics-store');
  void trackUsageEvent({
    type: 'media_processing',
    mediaType,
    modelId: resolved.modelId,
    provider: resolved.provider,
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    estimatedCost: estimateCost(resolved.modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0),
    timestamp: new Date().toISOString(),
  }).catch((error) => console.error('Failed to record media synthesis usage:', error));
  return text;
}
