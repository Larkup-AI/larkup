import { generateText } from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import { getModelsByType } from '@larkup/core/models-cache';
import {
  validateOcrResult,
  validateVisualObservations,
  type OcrAdapter,
  type OcrResult,
  type VisionAnalysisAdapter,
} from '@larkup/tool-video-audio';
import { createChatModel, resolveConfiguredVisionModel } from '@/lib/chat-model-provider';

function parseJsonObject(text: string): unknown {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(normalized);
}

/**
 * Server-only VLM adapter. It intentionally returns no prose fallback: model
 * output must validate against the media-tool contract before it can become
 * durable evidence.
 */
export function createConfiguredVisionAdapter(): VisionAnalysisAdapter {
  return {
    async analyze({ frames, previousContext, signal }) {
      if (frames.length === 0) return { observations: [] };
      const [config, models] = await Promise.all([readConfig(), getModelsByType('language')]);
      const resolved = resolveConfiguredVisionModel(config, models);
      const model = createChatModel(
        resolved.provider,
        resolved.modelId,
        resolved.apiKey,
        config.customVisionModels,
      ) as any;
      const images = await Promise.all(
        frames.map(async (frame) => {
          const { readFile } = await import('node:fs/promises');
          return { frame, data: (await readFile(frame.path)).toString('base64') };
        }),
      );
      const timestamps = frames.map((frame) => frame.timestampSecs);
      const prompt = [
        'Analyze these chronological video frames. Return JSON only, with this exact shape:',
        '{"observations":[{"kind":"object|action|ui|chart|relationship|state","value":"supported visible fact","frameTimestamps":[number],"confidence":number,"uncertaintyReasons":[string]}]}',
        '',
        'CRITICAL RULES:',
        '- Only report source-visible facts. Every frameTimestamps entry must be one of the supplied timestamps.',
        '- Do not identify people or infer identity.',
        '- For a state observation, value must be a JSON string containing subject, property, and value when those are explicitly visible (e.g., {"subject":"scoreboard","property":"score","value":"2-1"}).',
        '',
        'STATE TRACKING (very important):',
        '- Track any evolving on-screen state: scores, counters, timers, progress bars, text overlays, UI elements, labels, numbers.',
        '- When a tracked value changes from what was previously reported, explicitly note the transition with a state observation.',
        "- Always report the CURRENT value you see on screen, even if it was reported before — the latest frame's value is what matters.",
        '',
        `Supplied timestamps: ${JSON.stringify(timestamps)}.`,
        previousContext
          ? `Previous accepted context (continue tracking state changes from here): ${previousContext}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
      const { text } = await generateText({
        model,
        abortSignal: signal,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map(({ data }) => ({
                type: 'file' as const,
                mediaType: 'image/jpeg',
                data: `data:image/jpeg;base64,${data}`,
              })),
            ],
          },
        ],
      });
      const parsed = parseJsonObject(text) as { observations?: unknown };
      if (!Array.isArray(parsed.observations))
        throw new Error('Vision adapter returned no observations array.');
      const observations = parsed.observations.map((item) => {
        if (!item || typeof item !== 'object')
          throw new Error('Vision adapter returned an invalid observation.');
        const value = item as Record<string, unknown>;
        if (
          !['object', 'action', 'ui', 'chart', 'relationship', 'state'].includes(
            String(value.kind),
          ) ||
          typeof value.value !== 'string' ||
          !Array.isArray(value.frameTimestamps) ||
          typeof value.confidence !== 'number' ||
          !Array.isArray(value.uncertaintyReasons)
        )
          throw new Error('Vision adapter returned an invalid observation schema.');
        return {
          kind: value.kind as 'object' | 'action' | 'ui' | 'chart' | 'relationship' | 'state',
          value: value.value,
          frameTimestamps: value.frameTimestamps.map(Number),
          confidence: value.confidence,
          uncertaintyReasons: value.uncertaintyReasons.filter(
            (reason): reason is string => typeof reason === 'string',
          ),
        };
      });
      const validated = validateVisualObservations(observations);
      if (
        validated.length !== observations.length ||
        validated.some((item) =>
          item.frameTimestamps.some((timestamp) => !timestamps.includes(timestamp)),
        )
      ) {
        throw new Error(
          'Vision adapter returned observations without valid source-frame provenance.',
        );
      }
      void trackUsageEvent({
        type: 'media_vision_analysis',
        modelId: resolved.modelId,
        provider: resolved.provider,
        frameCount: frames.length,
        observationCount: validated.length,
        timestamp: new Date().toISOString(),
      });
      return { observations: validated };
    },
  };
}

/** OCR adapters are injected by a workspace integration; this wrapper keeps malformed output out of storage. */
export function withValidatedOcr(adapter: OcrAdapter): OcrAdapter {
  return {
    async recognize(input): Promise<OcrResult> {
      return validateOcrResult(await adapter.recognize(input));
    },
  };
}

/**
 * Server-only fallback OCR adapter for installations without a dedicated OCR
 * integration. It is deliberately opt-in (high-resolution OCR/code
 * inspections), schema-validated, and marked as uncalibrated downstream.
 */
export function createConfiguredOcrAdapter(): OcrAdapter {
  return {
    async recognize({ imagePath, languages, signal }) {
      const [config, models] = await Promise.all([readConfig(), getModelsByType('language')]);
      const resolved = resolveConfiguredVisionModel(config, models);
      const model = createChatModel(
        resolved.provider,
        resolved.modelId,
        resolved.apiKey,
        config.customVisionModels,
      ) as any;
      const { readFile } = await import('node:fs/promises');
      const data = (await readFile(imagePath)).toString('base64');
      const { text } = await generateText({
        model,
        abortSignal: signal,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Read visible text only. Return JSON {"blocks":[{"text":string,"left":number,"top":number,"width":number,"height":number,"confidence":number,"language":string,"direction":"ltr|rtl|ttb"}]}. Coordinates are normalized 0–1. Preserve RTL/CJK order. Language hints: ${
                  (languages ?? []).join(', ') || 'auto'
                }.`,
              },
              {
                type: 'file' as const,
                mediaType: 'image/jpeg',
                data: `data:image/jpeg;base64,${data}`,
              },
            ],
          },
        ],
      });
      const parsed = parseJsonObject(text) as OcrResult;
      const result = validateOcrResult({
        ...parsed,
        provider: resolved.provider,
        model: resolved.modelId,
      });
      void trackUsageEvent({
        type: 'media_ocr',
        modelId: resolved.modelId,
        provider: resolved.provider,
        blockCount: result.blocks.length,
        timestamp: new Date().toISOString(),
      });
      return result;
    },
  };
}

export interface AnonymousPersonTrack {
  trackId: string;
  startSecs: number;
  endSecs: number;
  frameTimestamps: number[];
  confidence: number;
  limitations: string[];
}

/** Anonymous, bounded tracking adapter: identity recognition is explicitly prohibited. */
export function createConfiguredPersonTracker() {
  return {
    async track(
      frames: Array<{ path: string; timestampSecs: number }>,
    ): Promise<AnonymousPersonTrack[]> {
      if (frames.length === 0) return [];
      const [config, models] = await Promise.all([readConfig(), getModelsByType('language')]);
      const resolved = resolveConfiguredVisionModel(config, models);
      const model = createChatModel(
        resolved.provider,
        resolved.modelId,
        resolved.apiKey,
        config.customVisionModels,
      ) as any;
      const images = await Promise.all(
        frames.map(async (frame) => {
          const { readFile } = await import('node:fs/promises');
          return (await readFile(frame.path)).toString('base64');
        }),
      );
      const timestamps = frames.map((frame) => frame.timestampSecs);
      const { text } = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  'Track only anonymous visible people across these chronological frames. Return JSON only:',
                  '{"tracks":[{"frameTimestamps":[number],"confidence":number,"limitations":[string]}]}',
                  `Allowed frame timestamps: ${JSON.stringify(timestamps)}.`,
                  'A track represents one visually continuous anonymous person within this bounded bundle. Never infer identity, gender, age, ethnicity, or cross-video matching. Omit uncertain tracks rather than guessing.',
                ].join('\n'),
              },
              ...images.map((data) => ({
                type: 'file' as const,
                mediaType: 'image/jpeg',
                data: `data:image/jpeg;base64,${data}`,
              })),
            ],
          },
        ],
      });
      const parsed = parseJsonObject(text) as { tracks?: unknown };
      if (!Array.isArray(parsed.tracks))
        throw new Error('Person tracker returned no tracks array.');
      const tracks = parsed.tracks.flatMap((candidate, index): AnonymousPersonTrack[] => {
        if (!candidate || typeof candidate !== 'object') return [];
        const track = candidate as Record<string, unknown>;
        if (
          !Array.isArray(track.frameTimestamps) ||
          typeof track.confidence !== 'number' ||
          !Array.isArray(track.limitations)
        )
          return [];
        const frameTimestamps = [...new Set(track.frameTimestamps.map(Number))]
          .filter((timestamp) => timestamps.includes(timestamp))
          .sort((left, right) => left - right);
        if (frameTimestamps.length === 0 || track.confidence < 0 || track.confidence > 1) return [];
        return [
          {
            trackId: `track-${index + 1}`,
            startSecs: frameTimestamps[0],
            endSecs: frameTimestamps.at(-1)!,
            frameTimestamps,
            confidence: track.confidence,
            limitations: [
              ...track.limitations.filter((value): value is string => typeof value === 'string'),
              'Anonymous bounded visual track only; no biometric identification or cross-video matching.',
            ],
          },
        ];
      });
      void trackUsageEvent({
        type: 'media_vision_analysis',
        modelId: resolved.modelId,
        provider: resolved.provider,
        frameCount: frames.length,
        observationCount: tracks.length,
        timestamp: new Date().toISOString(),
      });
      return tracks;
    },
  };
}
