/**
 * Audio processing pipeline.
 *
 * Transcription strategies:
 * 1. Explicitly selected Audio Provider API (OpenAI, Groq, Deepgram, or ElevenLabs)
 * 2. Local Whisper.cpp — fully offline via nodejs-whisper (optional)
 *
 * The transcription is split into timestamped chunks for granular
 * retrieval in the RAG pipeline.
 */

export interface TranscriptChunk {
  text: string;
  startSecs: number;
  endSecs: number;
}

export interface TranscriptionOrigin {
  kind: 'youtube-manual' | 'youtube-auto' | 'provider-stt' | 'local-stt';
  provider?: string;
  language?: string;
}

export interface TranscriptionResult {
  /** Full transcript text */
  fullText: string;
  /** Timestamped chunks for granular indexing */
  chunks: TranscriptChunk[];
  /** Detected language */
  language?: string;
  /** Duration of the audio in seconds */
  durationSecs: number;
  /** How the transcript was produced, so callers can judge source authority. */
  origin?: TranscriptionOrigin;
}

export interface TranscriptionOptions {
  /** The provider name (e.g. 'openai', 'deepgram', 'local') */
  provider?: string;
  /** The API key to use */
  apiKey?: string;
  /** Chunk duration in seconds for splitting transcript (default: 30) */
  chunkDurationSecs?: number;
  /** Language hint (e.g., "en", "de") */
  language?: string;
  /** Short context such as the media title, used to preserve names and infer Arabic. */
  context?: string;
  /** Reports completed transcription work and its current unit. */
  onProgress?: (
    current: number,
    total: number,
    message: string,
    unit?: string,
  ) => void | Promise<void>;
}

const DEEPGRAM_TRANSCRIPTION_URL = 'https://api.deepgram.com/v1/listen';
const AUTO_LANGUAGE = 'auto';

/**
 * Infer only languages that cannot reliably use Deepgram's automatic language
 * detection. Other text intentionally returns undefined so the provider can
 * perform its own detection.
 */
export function inferLanguageHintFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const letters = text.match(/\p{Letter}/gu) ?? [];
  if (letters.length === 0) return undefined;

  const arabicLetters = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  return arabicLetters >= 2 && arabicLetters / letters.length >= 0.2 ? 'ar' : undefined;
}

/**
 * Build the Deepgram request URL without reading environment or provider state,
 * making provider routing and language behavior straightforward to test.
 */
export function buildDeepgramTranscriptionUrl(
  options: Pick<TranscriptionOptions, 'language' | 'context'> = {},
): string {
  const configuredLanguage = normalizeLanguage(options.language);
  const language = configuredLanguage ?? inferLanguageHintFromText(options.context);
  const url = new URL(DEEPGRAM_TRANSCRIPTION_URL);

  url.searchParams.set('model', language ? 'nova-3' : 'nova-3-general');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('punctuate', 'true');
  url.searchParams.set('diarize', 'false');

  if (language) {
    url.searchParams.set('language', language);
  } else {
    url.searchParams.set('detect_language', 'true');
  }

  for (const keyterm of extractContextKeyterms(options.context)) {
    url.searchParams.append('keyterm', keyterm);
  }

  return url.toString();
}

/**
 * Transcribe an audio file and return timestamped chunks.
 */
export async function transcribeAudio(
  audioPath: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const provider = requireTranscriptionProvider(options);
  await reportProgress(
    options,
    0,
    1,
    `Transcribing with ${formatProviderName(provider)}...`,
    'request',
  );

  const result =
    provider === 'local'
      ? await transcribeLocal(audioPath, options)
      : await transcribeViaApi(audioPath, options);

  await reportProgress(options, 1, 1, 'Transcription complete.', 'request');
  return result;
}

/**
 * Full pipeline: transcribe + chunk for an audio file.
 */
export async function processAudio(
  audioPath: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const provider = requireTranscriptionProvider(options);
  if (provider !== 'local') {
    const { promises: fs } = await import('node:fs');
    const stat = await fs.stat(audioPath);
    const durationSecs = await probeAudioDuration(audioPath);
    if (stat.size > 24 * 1024 * 1024 || durationSecs > 10 * 60) {
      return transcribeLongAudio(audioPath, durationSecs, options);
    }
  }
  return transcribeAudio(audioPath, options);
}

async function transcribeLongAudio(
  audioPath: string,
  durationSecs: number,
  options: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-transcription-'));

  try {
    await reportProgress(options, 0, 100, 'Preparing long audio for transcription...', '%');
    const parts = await splitAudio(audioPath, outputDir, 10 * 60, (progress) =>
      reportProgress(
        options,
        Math.round(progress * 20),
        100,
        `Preparing long audio (${Math.round(progress * 100)}%)...`,
        '%',
      ),
    );
    if (parts.length === 0) throw new Error('Audio splitting produced no transcription chunks.');
    let completedParts = 0;
    let progressQueue = Promise.resolve();
    const queueProgress = (current: number, message: string) => {
      progressQueue = progressQueue.then(() =>
        reportProgress(options, Math.round(20 + (current / parts.length) * 80), 100, message, '%'),
      );
      return progressQueue;
    };

    await queueProgress(0, `Transcribing 0 of ${parts.length} audio parts...`);
    const results = await mapWithConcurrency(parts, 2, async (part, index) => {
      const result = await transcribeViaApi(part, options);
      const offset = index * 10 * 60;
      const adjustedResult = {
        ...result,
        chunks: result.chunks.map((chunk) => ({
          ...chunk,
          startSecs: chunk.startSecs + offset,
          endSecs: chunk.endSecs + offset,
        })),
      };
      completedParts += 1;
      await queueProgress(
        completedParts,
        `Transcribed ${completedParts} of ${parts.length} audio parts.`,
      );
      return adjustedResult;
    });
    await progressQueue;

    return {
      fullText: results
        .map((result) => result.fullText)
        .filter(Boolean)
        .join(' '),
      chunks: results.flatMap((result) => result.chunks),
      language: results.find((result) => result.language)?.language,
      durationSecs: durationSecs || results.reduce((sum, result) => sum + result.durationSecs, 0),
      origin: results.find((result) => result.origin)?.origin,
    };
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* API-based transcription                                             */
/* ------------------------------------------------------------------ */

async function transcribeViaApi(
  audioPath: string,
  options: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const { promises: fs } = await import('node:fs');
  const audioBuffer = await fs.readFile(audioPath);
  const path = await import('node:path');
  const fileName = path.basename(audioPath);

  const provider = requireTranscriptionProvider(options);
  const apiKey = options.apiKey;

  if (!apiKey) {
    throw new Error(
      `API Key is required for ${provider} transcription. ` +
        `Please configure it in the Tool Settings.`,
    );
  }

  const chunkDuration = options.chunkDurationSecs ?? 30;
  const supportedProviders = new Set(['openai', 'groq', 'deepgram', 'elevenlabs']);
  if (!supportedProviders.has(provider)) {
    throw new Error(
      `${provider} does not provide a configured speech-to-text integration. ` +
        'Choose OpenAI, Groq, Deepgram, ElevenLabs, or Local Whisper in Tool Settings.',
    );
  }

  // 1. Handle Deepgram Native API
  if (provider === 'deepgram') {
    const dgUrl = buildDeepgramTranscriptionUrl(options);
    const res = await fetch(dgUrl, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': contentTypeForFile(fileName),
      },
      body: audioBuffer,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deepgram API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const channel = data.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    const text = alt?.transcript || '';
    const words = alt?.words || [];
    const requestedLanguage =
      normalizeLanguage(options.language) ?? inferLanguageHintFromText(options.context);
    const detectedLanguage =
      channel?.detected_language ??
      alt?.languages?.[0] ??
      data.metadata?.language ??
      requestedLanguage;

    const chunks: TranscriptChunk[] = [];
    let currentText = '';
    let chunkStart = words[0]?.start ?? 0;
    let chunkEnd = words[0]?.end ?? 0;

    for (const w of words) {
      if (w.start - chunkStart >= chunkDuration && currentText.trim()) {
        chunks.push({
          text: currentText.trim(),
          startSecs: chunkStart,
          endSecs: chunkEnd,
        });
        currentText = w.punctuated_word || w.word;
        chunkStart = w.start;
        chunkEnd = w.end;
      } else {
        currentText += (currentText ? ' ' : '') + (w.punctuated_word || w.word);
        chunkEnd = w.end;
      }
    }
    if (currentText.trim()) {
      chunks.push({ text: currentText.trim(), startSecs: chunkStart, endSecs: chunkEnd });
    }

    const language = typeof detectedLanguage === 'string' ? detectedLanguage : undefined;
    return {
      fullText: text,
      chunks,
      language,
      durationSecs: data.metadata?.duration ?? 0,
      origin: { kind: 'provider-stt', provider, language },
    };
  }

  // 2. Handle OpenAI-compatible APIs (OpenAI, Groq, etc)
  let url = 'https://api.openai.com/v1/audio/transcriptions';
  let model = 'whisper-1';

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    model = 'whisper-large-v3';
  } else if (provider === 'elevenlabs') {
    url = 'https://api.elevenlabs.io/v1/speech-to-text';
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), fileName);
  const language = normalizeLanguage(options.language);

  if (provider !== 'elevenlabs') {
    formData.append('model', model);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    if (language) {
      formData.append('language', language);
    }
    const context = normalizeContext(options.context);
    if (context) {
      formData.append('prompt', context);
    }
  } else {
    formData.append('model_id', 'scribe_v2');
    if (language) formData.append('language_code', language);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: provider === 'elevenlabs' ? apiKey : `Bearer ${apiKey}`,
      ...(provider === 'elevenlabs' ? { 'xi-api-key': apiKey } : {}),
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider} API error (${res.status}): ${err}`);
  }

  const data = await res.json();

  // ElevenLabs format is slightly different
  if (provider === 'elevenlabs') {
    const words = data.words || [];
    const chunks: TranscriptChunk[] = [];
    let currentText = '';
    let chunkStart = words[0]?.start ?? 0;
    let chunkEnd = words[0]?.end ?? 0;

    for (const w of words) {
      if (w.start - chunkStart >= chunkDuration && currentText.trim()) {
        chunks.push({ text: currentText.trim(), startSecs: chunkStart, endSecs: chunkEnd });
        currentText = w.text;
        chunkStart = w.start;
        chunkEnd = w.end;
      } else {
        currentText += (currentText ? ' ' : '') + w.text;
        chunkEnd = w.end;
      }
    }
    if (currentText.trim()) {
      chunks.push({ text: currentText.trim(), startSecs: chunkStart, endSecs: chunkEnd });
    }

    return {
      fullText: data.text,
      chunks,
      language: data.language_code ?? language,
      durationSecs: words[words.length - 1]?.end ?? 0,
      origin: {
        kind: 'provider-stt',
        provider,
        language: data.language_code ?? language,
      },
    };
  }

  // OpenAI/Groq compatible format
  const segments = data.segments || [];
  const chunks = mergeSegmentsIntoChunks(segments, chunkDuration);

  return {
    fullText: data.text,
    chunks,
    language: data.language,
    durationSecs: data.duration ?? 0,
    origin: {
      kind: 'provider-stt',
      provider,
      language: data.language ?? language,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Local Whisper transcription                                         */
/* ------------------------------------------------------------------ */

async function transcribeLocal(
  audioPath: string,
  options: TranscriptionOptions,
): Promise<TranscriptionResult> {
  // Try to load nodejs-whisper
  let whisper: any;
  try {
    whisper = await import('nodejs-whisper');
  } catch {
    throw new Error(
      'Local Whisper is not installed. ' +
        'Install it with: pnpm add nodejs-whisper -w ' +
        'or switch to API-based transcription.',
    );
  }

  const result = await whisper.nodewhisper(audioPath, {
    modelName: 'base',
    autoDownloadModelName: 'base',
    whisperOptions: {
      outputInText: true,
      outputInVtt: false,
      outputInSrt: false,
      outputInCsv: false,
      translateToEnglish: false,
      wordTimestamps: true,
      language: normalizeLanguage(options.language) ?? AUTO_LANGUAGE,
    },
  });

  const fullText = typeof result === 'string' ? result : String(result);
  const chunkDuration = options.chunkDurationSecs ?? 30;

  // Without timestamps from local whisper, create fixed-size chunks
  const chunks = splitTextIntoChunks(fullText, chunkDuration);

  return {
    fullText,
    chunks,
    language: normalizeLanguage(options.language),
    durationSecs: 0, // Not available from basic whisper output
    origin: {
      kind: 'local-stt',
      provider: 'local',
      language: normalizeLanguage(options.language),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Chunking helpers                                                    */
/* ------------------------------------------------------------------ */

function mergeSegmentsIntoChunks(
  segments: { start: number; end: number; text: string }[],
  chunkDurationSecs: number,
): TranscriptChunk[] {
  if (segments.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let currentText = '';
  let chunkStart = segments[0].start;
  let chunkEnd = segments[0].end;

  for (const seg of segments) {
    if (seg.start - chunkStart >= chunkDurationSecs && currentText.trim()) {
      chunks.push({
        text: currentText.trim(),
        startSecs: chunkStart,
        endSecs: chunkEnd,
      });
      currentText = seg.text;
      chunkStart = seg.start;
      chunkEnd = seg.end;
    } else {
      currentText += ' ' + seg.text;
      chunkEnd = seg.end;
    }
  }

  if (currentText.trim()) {
    chunks.push({
      text: currentText.trim(),
      startSecs: chunkStart,
      endSecs: chunkEnd,
    });
  }

  return chunks;
}

function splitTextIntoChunks(text: string, chunkDurationSecs: number): TranscriptChunk[] {
  // Approximate: split text into equal parts based on word count
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Assume ~150 words per minute of speech
  const wordsPerChunk = Math.ceil((150 / 60) * chunkDurationSecs);
  const chunks: TranscriptChunk[] = [];
  let offset = 0;

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunkWords = words.slice(i, i + wordsPerChunk);
    const startSecs = offset;
    const endSecs = offset + chunkDurationSecs;
    chunks.push({
      text: chunkWords.join(' '),
      startSecs,
      endSecs,
    });
    offset = endSecs;
  }

  return chunks;
}

function contentTypeForFile(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'm4a' || extension === 'mp4') return 'audio/mp4';
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';
  if (extension === 'webm') return 'audio/webm';
  return 'audio/mpeg';
}

function normalizeLanguage(language?: string): string | undefined {
  const normalized = language?.trim();
  return !normalized || normalized.toLowerCase() === AUTO_LANGUAGE ? undefined : normalized;
}

function normalizeContext(context?: string): string | undefined {
  const normalized = context?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function extractContextKeyterms(context?: string): string[] {
  const normalized = normalizeContext(context);
  if (!normalized) return [];

  const candidates =
    normalized
      .replace(/https?:\/\/\S+/gi, ' ')
      .match(/[\p{Letter}\p{Number}][\p{Letter}\p{Mark}\p{Number}'’_-]{2,}/gu) ?? [];
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    const key = candidate.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, candidate.slice(0, 48));
    if (unique.size >= 12) break;
  }
  return [...unique.values()];
}

async function reportProgress(
  options: TranscriptionOptions,
  current: number,
  total: number,
  message: string,
  unit?: string,
): Promise<void> {
  try {
    await options.onProgress?.(current, total, message, unit);
  } catch {
    // Progress persistence must not invalidate an otherwise valid transcript.
  }
}

function requireTranscriptionProvider(options: TranscriptionOptions): string {
  const provider = options.provider?.trim();
  if (!provider) {
    throw new Error(
      'An Audio Provider is required for transcription. Choose one in Marketplace Tool Settings; transcription never falls back to OpenAI.',
    );
  }
  return provider;
}

function formatProviderName(provider: string): string {
  return provider
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

async function importFfmpeg() {
  return import('fluent-ffmpeg');
}

async function probeAudioDuration(audioPath: string): Promise<number> {
  const ffmpeg = await importFfmpeg();
  return new Promise((resolve, reject) => {
    ffmpeg.default.ffprobe(audioPath, (error: Error | null, data: any) => {
      if (error) reject(error);
      else resolve(Number(data.format?.duration ?? 0));
    });
  });
}

async function splitAudio(
  audioPath: string,
  outputDir: string,
  segmentSecs: number,
  onProgress?: (progress: number) => void | Promise<void>,
): Promise<string[]> {
  const ffmpeg = await importFfmpeg();
  const path = await import('node:path');
  const { promises: fs } = await import('node:fs');
  const pattern = path.join(outputDir, 'part_%04d.mp3');

  await new Promise<void>((resolve, reject) => {
    ffmpeg
      .default(audioPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16_000)
      .audioCodec('libmp3lame')
      .audioBitrate('32k')
      .format('segment')
      .outputOptions([`-segment_time ${segmentSecs}`, '-reset_timestamps 1'])
      .output(pattern)
      .on('progress', (progress: { percent?: number }) => {
        if (typeof progress.percent === 'number') {
          void onProgress?.(Math.max(0, Math.min(1, progress.percent / 100)));
        }
      })
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });

  return (await fs.readdir(outputDir))
    .filter((name) => /^part_\d+\.mp3$/.test(name))
    .sort()
    .map((name) => path.join(outputDir, name));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await callback(items[index], index);
      }
    }),
  );
  return results;
}
