import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateText } from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import { trackUsageEvent } from '@larkup/core/analytics-store';
import { createChatModel, resolveConfiguredVisionModel } from '@/lib/chat/model-provider';

/**
 * Re-watches a bounded stretch of an already-indexed video to settle a question
 * the index could not.
 *
 * The dispatched GPU pipeline exists to build an index: it uploads or reseeks
 * the source, cold-starts a worker, and runs decode, detection, OCR, and
 * captioning over a range. That is minutes of wall time, which is the right
 * trade for indexing and the wrong one for a person waiting on a reply -- the
 * turn's budget expires and the answer arrives empty, which reads as the video
 * not showing something it plainly does.
 *
 * Reading frames is not the expensive part. Sampling a bounded range off the
 * local file costs well under a second; the remaining cost is one multimodal
 * request, which is dominated by its own output rather than by how many frames
 * it carries. So a whole range goes out as a single request, and several ranges
 * go out at once.
 */

/**
 * Frames per request. The index has already located the bounded window, so an
 * interactive verification should sample it rather than upload near-video
 * frame density. Sixteen evenly-spaced frames stay below common multimodal
 * gateway body limits while still covering the beginning, changes, and end.
 */
const MAX_FRAMES_PER_LOOK = 16;
/** A short window is sampled densely, but never past what a viewer could tell apart. */
const MAX_FPS = 4;
/** Wide enough to read a small label or readout without inflating the request. */
const FRAME_WIDTH = 1024;
const EXTRACT_TIMEOUT_MS = 60_000;

export interface QuickLookRange {
  startSecs: number;
  endSecs: number;
  /** What this particular window is expected to settle. */
  lookingFor?: string;
}

export interface QuickLookFinding {
  range: { startSecs: number; endSecs: number };
  at: string;
  /** What the re-watch established, in the reader's own words. */
  found: string;
  /** Whether this bounded reading actually answers the question, not merely relates to it. */
  settlesQuestion: boolean;
  /** For requests about every visible subject, whether each one was individually covered. */
  coverageComplete?: boolean;
  /** Exact short strings actually read off the frames. */
  read: string[];
  confidence: 'high' | 'medium' | 'low';
  frameCount: number;
  elapsedMs: number;
  error?: string;
}

function timecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { shell: false });
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), EXTRACT_TIMEOUT_MS);
    child.stderr.on('data', (data) => (stderr += String(data)));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/**
 * Samples one range into JPEG frames. `-ss` before `-i` seeks by keyframe
 * before decoding, so cost tracks the range's length rather than its offset
 * into the source -- a look near the end of a long recording is as cheap as one
 * near the start.
 */
async function extractFrames(
  mediaPath: string,
  range: QuickLookRange,
  directory: string,
): Promise<Array<{ timestampSecs: number; file: string }>> {
  // Spend the frame budget across the whole window, but never sample faster
  // than a viewer could distinguish -- past a few frames a second, consecutive
  // frames are the same moment and cost fidelity elsewhere for nothing.
  const span = Math.max(0.5, range.endSecs - range.startSecs);
  const fps = Math.min(MAX_FPS, MAX_FRAMES_PER_LOOK / span);
  await runFfmpeg([
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(range.startSecs),
    '-to',
    String(range.endSecs),
    '-i',
    mediaPath,
    '-vf',
    `fps=${fps.toFixed(3)},scale=${FRAME_WIDTH}:-2`,
    '-q:v',
    '3',
    '-frames:v',
    String(MAX_FRAMES_PER_LOOK),
    path.join(directory, 'f_%04d.jpg'),
  ]);
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.jpg')).sort();
  return names.map((name, index) => ({
    timestampSecs: range.startSecs + index / fps,
    file: path.join(directory, name),
  }));
}

export function parseFinding(raw: string): {
  found?: string;
  read?: unknown;
  confidence?: unknown;
  settlesQuestion?: unknown;
  coverageComplete?: unknown;
} {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    if (start >= 0) {
      // A reader may prefix a short acknowledgement before an otherwise valid
      // object. Decoding the first object is cheaper than a second full look.
      for (let end = text.length; end > start; end -= 1) {
        if (text[end - 1] !== '}') continue;
        try {
          return JSON.parse(text.slice(start, end));
        } catch {
          /* keep shrinking */
        }
      }
    }
    // Not JSON at all: the prose is still the reader's answer.
    return { found: text.slice(0, 1_200) };
  }
}

async function lookAtRange(input: {
  mediaPath: string;
  range: QuickLookRange;
  question: string;
  transcript?: string;
  model: ReturnType<typeof createChatModel>;
  signal?: AbortSignal;
}): Promise<QuickLookFinding> {
  const startedAt = Date.now();
  const at = `${timecode(input.range.startSecs)}–${timecode(input.range.endSecs)}`;
  const base = {
    range: { startSecs: input.range.startSecs, endSecs: input.range.endSecs },
    at,
    read: [] as string[],
    confidence: 'low' as const,
    settlesQuestion: false,
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-quick-look-'));
  try {
    const frames = await extractFrames(input.mediaPath, input.range, directory);
    if (frames.length === 0) {
      return {
        ...base,
        found: '',
        frameCount: 0,
        elapsedMs: Date.now() - startedAt,
        error: 'No frames could be read from this range.',
      };
    }
    const content: Array<Record<string, unknown>> = [];
    for (const frame of frames) {
      content.push({ type: 'text', text: `@${timecode(frame.timestampSecs)}` });
      content.push({
        type: 'file',
        mediaType: 'image/jpeg',
        data: `data:image/jpeg;base64,${(await fs.readFile(frame.file)).toString('base64')}`,
      });
    }
    content.push({
      type: 'text',
      text: [
        'These are consecutive frames from one continuous stretch of a video, in order.',
        `Question being answered: ${input.question}`,
        input.range.lookingFor ? `What to establish here: ${input.range.lookingFor}` : '',
        input.transcript
          ? `What is said during this stretch: ${input.transcript.slice(0, 4_000)}`
          : '',
        '',
        'Read every informative piece of on-screen text exactly, including anything that appears',
        'only briefly, and say what each is attached to. On-screen text and speech are legitimate',
        'ways to identify people and things -- use them, and say what established an identity.',
        'Track what changes across the frames; a value that differs between two frames is an event.',
        'A displayed value can change and then change back: a correction, a reversal, a review, a',
        'retraction, an undo. When that happens, report the value it SETTLES on last, and say the',
        'earlier value appeared and was reverted -- do not report a value that was taken back as',
        'though it stood. Read the last frames especially carefully for this.',
        'Mark anything you conclude rather than read with "(inferred)". Never invent a name, number,',
        'or value you did not see or hear. Any name or exact value you state must also appear in',
        'your "read" list, quoted as it appeared; if you cannot quote it, you did not read it, so',
        'describe what you saw without it. If these frames genuinely do not settle the question,',
        'say what is missing rather than filling it in, and set "settlesQuestion" to false. Set it',
        'to true only when the information in these frames and aligned speech is sufficient to',
        'answer the exact question. Related evidence alone is not a settled answer.',
        'If the question asks about each, every, both, or all visible subjects, use the clearest',
        'group frame and enumerate every subject separately in stable left-to-right order. Do not',
        'set "coverageComplete" or "settlesQuestion" true if even one requested subject is omitted.',
        'A social handle or nearby label identifies a person only when its placement unmistakably',
        'attaches it to that person; otherwise describe them by position and visible appearance.',
        'For a group-appearance question, answer positionally and do not use social handles as',
        'person identities; a handle is weaker evidence than the visible left-to-right ordering.',
        '',
        'Return JSON only, and keep it short:',
        '{"settlesQuestion":true|false,"coverageComplete":true|false,',
        '"found":"what you established, 1-3 sentences",',
        '"confidence":"high|medium|low",',
        '"read":["up to 5 exact short quotes of text you actually read on screen"]}',
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const { text, usage } = await generateText({
      model: input.model as Parameters<typeof generateText>[0]['model'],
      abortSignal: input.signal,
      messages: [{ role: 'user', content: content as never }],
    });
    const parsed = parseFinding(text ?? '');
    void trackUsageEvent({
      type: 'media_processing',
      mediaType: 'video',
      mediaOperation: 'inspection',
      frameCount: frames.length,
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
    return {
      ...base,
      found: typeof parsed.found === 'string' ? parsed.found : '',
      settlesQuestion: parsed.settlesQuestion === true,
      coverageComplete:
        typeof parsed.coverageComplete === 'boolean' ? parsed.coverageComplete : undefined,
      read: Array.isArray(parsed.read)
        ? parsed.read.filter((item): item is string => typeof item === 'string').slice(0, 5)
        : [],
      confidence:
        parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low',
      frameCount: frames.length,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ...base,
      found: '',
      frameCount: 0,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'The bounded re-watch failed.',
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Re-watches each range and returns what it established. Ranges are independent,
 * so they run together: a question needing three separate moments checked costs
 * about the same wall time as one.
 */
export async function quickLook(input: {
  mediaPath: string;
  question: string;
  ranges: QuickLookRange[];
  /** Speech aligned to each range, when the caller already holds it. */
  transcriptFor?: (range: QuickLookRange) => string | undefined;
  signal?: AbortSignal;
}): Promise<QuickLookFinding[]> {
  const ranges = input.ranges
    .filter((range) => Number.isFinite(range.startSecs) && range.endSecs > range.startSecs)
    .slice(0, 4);
  if (ranges.length === 0) return [];
  const config = await readConfig();
  const resolved = resolveConfiguredVisionModel(config, await getModelsByType('language'));
  const model = createChatModel(
    resolved.provider,
    resolved.modelId,
    resolved.apiKey,
    config.customVisionModels,
  );
  return Promise.all(
    ranges.map((range) =>
      lookAtRange({
        mediaPath: input.mediaPath,
        range,
        question: input.question,
        transcript: input.transcriptFor?.(range),
        model,
        signal: input.signal,
      }),
    ),
  );
}

/** True when a re-watch produced something an answer can actually rest on. */
export function isUsableFinding(finding: QuickLookFinding): boolean {
  return (
    !finding.error &&
    finding.settlesQuestion &&
    finding.coverageComplete !== false &&
    finding.found.trim().length > 0
  );
}

/**
 * What ffmpeg should open for this asset.
 *
 * A presigned URL is preferred over downloading: with `-ss` ahead of `-i`,
 * ffmpeg range-requests only the bytes around the window, so re-watching thirty
 * seconds of a long recording never transfers the whole file. Falling back to a
 * full retrieve keeps assets on storage backends without presigning usable.
 */
export async function resolveQuickLookSource(
  storageUri: string,
  fileName: string,
): Promise<{ mediaPath: string; cleanup: () => Promise<void> }> {
  const { createStorageProvider } = await import('@larkup/marketplace/storage');
  const storage = createStorageProvider();
  const local = await storage.resolvePath?.(storageUri).catch(() => undefined);
  if (local) return { mediaPath: local, cleanup: async () => undefined };
  const readUrl = await storage.getReadUrl?.(storageUri, 3_600).catch(() => undefined);
  if (readUrl) return { mediaPath: readUrl, cleanup: async () => undefined };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'larkup-quick-source-'));
  const mediaPath = path.join(directory, `source.${fileName.split('.').pop() || 'mp4'}`);
  await fs.writeFile(mediaPath, await storage.retrieve(storageUri));
  return {
    mediaPath,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }).catch(() => undefined),
  };
}
