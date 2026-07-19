/**
 * Audio processing pipeline.
 *
 * Transcription strategies:
 * 1. AI Provider API (default) — uses the configured chat provider's
 *    speech-to-text endpoint (e.g., OpenAI Whisper API)
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

export interface TranscriptionResult {
  /** Full transcript text */
  fullText: string;
  /** Timestamped chunks for granular indexing */
  chunks: TranscriptChunk[];
  /** Detected language */
  language?: string;
  /** Duration of the audio in seconds */
  durationSecs: number;
}

export interface TranscriptionOptions {
  /** "api" (default) or "local" */
  provider?: 'api' | 'local';
  /** Chunk duration in seconds for splitting transcript (default: 30) */
  chunkDurationSecs?: number;
  /** Language hint (e.g., "en", "de") */
  language?: string;
}

/**
 * Transcribe an audio file and return timestamped chunks.
 */
export async function transcribeAudio(
  audioPath: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  const provider = options.provider ?? 'api';

  if (provider === 'local') {
    return transcribeLocal(audioPath, options);
  }
  return transcribeViaApi(audioPath, options);
}

/**
 * Full pipeline: transcribe + chunk for an audio file.
 */
export async function processAudio(
  audioPath: string,
  options: TranscriptionOptions = {},
): Promise<TranscriptionResult> {
  return transcribeAudio(audioPath, options);
}

/* ------------------------------------------------------------------ */
/* API-based transcription                                             */
/* ------------------------------------------------------------------ */

async function transcribeViaApi(
  audioPath: string,
  options: TranscriptionOptions,
): Promise<TranscriptionResult> {
  // Use OpenAI's Whisper API via fetch
  // The caller should have OPENAI_API_KEY in environment
  const { promises: fs } = await import('node:fs');
  const audioBuffer = await fs.readFile(audioPath);
  const path = await import('node:path');
  const fileName = path.basename(audioPath);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for API-based transcription. ' +
        'Set it in your environment or switch to local Whisper.',
    );
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), fileName);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  if (options.language) {
    formData.append('language', options.language);
  }

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription API error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    text: string;
    language?: string;
    duration?: number;
    segments?: { start: number; end: number; text: string }[];
  };

  const chunkDuration = options.chunkDurationSecs ?? 30;
  const chunks = mergeSegmentsIntoChunks(data.segments ?? [], chunkDuration);

  return {
    fullText: data.text,
    chunks,
    language: data.language,
    durationSecs: data.duration ?? 0,
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
    modelName: 'base.en',
    autoDownloadModelName: 'base.en',
    whisperOptions: {
      outputInText: true,
      outputInVtt: false,
      outputInSrt: false,
      outputInCsv: false,
      translateToEnglish: false,
      wordTimestamps: true,
      language: options.language ?? 'auto',
    },
  });

  const fullText = typeof result === 'string' ? result : String(result);
  const chunkDuration = options.chunkDurationSecs ?? 30;

  // Without timestamps from local whisper, create fixed-size chunks
  const chunks = splitTextIntoChunks(fullText, chunkDuration);

  return {
    fullText,
    chunks,
    durationSecs: 0, // Not available from basic whisper output
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
