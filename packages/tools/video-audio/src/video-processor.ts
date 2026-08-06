import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ffprobe, runFfmpeg } from './ffmpeg-spawn.js';
import { selectFramesByInformationGain } from './frame-selector.js';
import type {
  MediaProbeResult,
  StreamInfo,
  FrameArtifact,
  FrameExtractionOptions,
  InspectionRequest,
  InspectionResult,
} from './contracts.js';

export interface VideoProcessResult {
  audioPath?: string;
  /** Extraction failure is distinct from a source that has no usable audio. */
  audioExtractionError?: string;
  frames: { path: string; timestampSecs: number }[];
  meta: {
    durationSecs: number;
    width: number;
    height: number;
    codec: string;
  };
}

/**
 * A low-resolution activity probe. These are deliberately cheap visual
 * changes, not semantic detections: the worker uses them to slow down around
 * potential activity before spending vision-model calls.
 */
export interface ActivityProbeOptions {
  outputDir: string;
  durationSecs: number;
  maxFrames: number;
  startSecs?: number;
  endSecs?: number;
  minGapSecs?: number;
  threshold?: number;
  threads?: number;
  signal?: AbortSignal;
}

export interface VideoProcessOptions {
  outputDir: string;
  frameIntervalSecs?: number;
  maxFrames?: number;
  sceneThreshold?: number;
  threads?: number;
  parallelExtraction?: boolean;
  /** Maximum source duration processed in one extraction batch. */
  chunkDurationSecs?: number;
  skipAudioExtraction?: boolean;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface VideoSamplingPlan {
  durationSecs: number;
  maxFrames: number;
  periodicIntervalSecs: number;
  periodicFrameCount: number;
  sceneFrameCount: number;
  endingFrameCount: number;
  minimumSceneGapSecs: number;
  estimatedFrameCount: number;
}

export interface EndingSamplingPlan {
  startSecs: number;
  intervalSecs: number;
  frameCount: number;
  timestamps: number[];
}

/** Create deterministic overlapping chunks without retaining a whole video in memory. */
export function createTimelineChunkPlan(
  durationSecs: number,
  chunkDurationSecs = 300,
  overlapSecs = 3,
): Array<{
  index: number;
  startSecs: number;
  endSecs: number;
  overlapStartSecs: number;
  overlapEndSecs: number;
}> {
  const duration = Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0;
  const chunk = Number.isFinite(chunkDurationSecs) ? Math.max(1, chunkDurationSecs) : 300;
  const overlap = Number.isFinite(overlapSecs) ? Math.max(0, Math.min(overlapSecs, chunk / 2)) : 3;
  const result: Array<{
    index: number;
    startSecs: number;
    endSecs: number;
    overlapStartSecs: number;
    overlapEndSecs: number;
  }> = [];
  for (let startSecs = 0, index = 0; startSecs < duration; startSecs += chunk, index++) {
    const endSecs = Math.min(duration, startSecs + chunk);
    result.push({
      index,
      startSecs,
      endSecs,
      overlapStartSecs: index === 0 ? startSecs : Math.max(0, startSecs - overlap),
      overlapEndSecs: endSecs === duration ? endSecs : Math.min(duration, endSecs + overlap),
    });
  }
  return result;
}

export interface TimedText {
  text: string;
  startSecs: number;
  endSecs: number;
}

export interface MultimodalSegment extends TimedText {
  transcript: string;
  visualContext: string;
  sequence: number;
  cumulativeState: string;
}

// Keep the carry-over small enough that a long quiet recording cannot crowd
// out evidence from the active bundle. The durable evidence store—not prompt
// history—is the source of truth for older context.
const MAX_CUMULATIVE_CONTEXT_LENGTH = 500;

/**
 * Return a bounded, language-neutral excerpt suitable for carrying evidence
 * into a later timeline segment. The name is retained for API compatibility.
 */
export function extractRunningState(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(-MAX_CUMULATIVE_CONTEXT_LENGTH);
}

function appendRunningState(previous: string, current: string): string {
  if (!current) return previous;
  if (!previous) return current;
  if (previous.includes(current)) return previous;
  return `${previous}\n${current}`.slice(-MAX_CUMULATIVE_CONTEXT_LENGTH);
}

export function buildMultimodalSegments(
  transcript: TimedText[],
  visuals: TimedText[],
  durationSecs: number,
  targetWindowSecs = 60,
): MultimodalSegment[] {
  const evidence = [...transcript, ...visuals];
  if (evidence.length === 0) return [];

  const knownEnd = Math.max(durationSecs, ...evidence.map((item) => item.endSecs));
  const segments: MultimodalSegment[] = [];
  let runningState = '';

  for (let startSecs = 0; startSecs < knownEnd; startSecs += targetWindowSecs) {
    const endSecs = Math.min(startSecs + targetWindowSecs, knownEnd);
    const overlaps = (item: TimedText) => item.startSecs < endSecs && item.endSecs > startSecs;
    const spoken = transcript
      .filter(overlaps)
      .map((item) => item.text.trim())
      .filter(Boolean);
    const seen = visuals
      .filter(overlaps)
      .map((item) => item.text.trim())
      .filter(Boolean);
    if (spoken.length === 0 && seen.length === 0) continue;

    const transcriptText = [...new Set(spoken)].join(' ');
    const visualContext = [...new Set(seen)].join(' ');
    const currentEvidence = [transcriptText, visualContext].filter(Boolean).join('\n');
    const parts = [
      `Timeline: ${formatTimestamp(startSecs)}–${formatTimestamp(endSecs)}.`,
      runningState ? `Running state from earlier: ${runningState}` : '',
      transcriptText ? `Speech: ${transcriptText}` : '',
      visualContext ? `Visual sequence, actions, and on-screen text: ${visualContext}` : '',
    ].filter(Boolean);

    const segmentText = parts.join('\n');
    runningState = appendRunningState(runningState, extractRunningState(currentEvidence));

    segments.push({
      text: segmentText,
      transcript: transcriptText,
      visualContext,
      startSecs,
      endSecs,
      sequence: Math.floor(startSecs / targetWindowSecs),
      cumulativeState: runningState,
    });
  }

  return segments;
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function createVideoSamplingPlan(
  durationSecs: number,
  configuredInterval = 30,
  maxFrames = 100,
): VideoSamplingPlan {
  const duration = Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0;
  const hardLimit = Number.isFinite(maxFrames) ? Math.max(1, Math.floor(maxFrames)) : 100;
  const requestedInterval =
    Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : 30;

  let periodicFloorSecs: number;
  let sceneCadenceSecs: number;
  if (duration <= 15 * 60) {
    periodicFloorSecs = 15;
    sceneCadenceSecs = 15;
  } else if (duration <= 60 * 60) {
    periodicFloorSecs = 30;
    sceneCadenceSecs = 30;
  } else if (duration <= 4 * 60 * 60) {
    periodicFloorSecs = 60;
    sceneCadenceSecs = 60;
  } else if (duration <= 12 * 60 * 60) {
    periodicFloorSecs = 10 * 60;
    sceneCadenceSecs = 10 * 60;
  } else {
    periodicFloorSecs = 5 * 60;
    sceneCadenceSecs = 5 * 60;
  }

  const preferredInterval = Math.max(requestedInterval, periodicFloorSecs);
  const desiredPeriodicCount = Math.max(1, Math.ceil(duration / preferredInterval));
  const desiredSceneCount = duration > 0 ? Math.max(1, Math.ceil(duration / sceneCadenceSecs)) : 0;
  const desiredTotal = desiredPeriodicCount + desiredSceneCount;
  const desiredEndingCount =
    duration >= 60 ? Math.ceil(Math.min(90, duration) / (duration <= 2 * 60 * 60 ? 5 : 15)) : 0;
  const endingFrameCount =
    desiredEndingCount > 0
      ? Math.min(
          desiredEndingCount,
          hardLimit === 1 ? 1 : Math.max(1, Math.min(hardLimit - 1, Math.floor(hardLimit * 0.2))),
        )
      : 0;
  const coverageLimit = Math.max(0, hardLimit - endingFrameCount);

  let periodicFrameCount: number;
  let sceneFrameCount: number;
  if (coverageLimit === 0) {
    periodicFrameCount = 0;
    sceneFrameCount = 0;
  } else if (desiredTotal <= coverageLimit) {
    periodicFrameCount = desiredPeriodicCount;
    sceneFrameCount = desiredSceneCount;
  } else if (coverageLimit === 1 || desiredSceneCount === 0) {
    periodicFrameCount = 1;
    sceneFrameCount = 0;
  } else {
    periodicFrameCount = Math.max(
      1,
      Math.min(
        coverageLimit - 1,
        Math.round((coverageLimit * desiredPeriodicCount) / desiredTotal),
      ),
    );
    sceneFrameCount = coverageLimit - periodicFrameCount;
  }

  const periodicIntervalSecs =
    periodicFrameCount > 0 && periodicFrameCount < desiredPeriodicCount && duration > 0
      ? Math.max(preferredInterval, duration / periodicFrameCount)
      : preferredInterval;
  const minimumSceneGapSecs =
    sceneFrameCount > 0 ? Math.max(1, periodicIntervalSecs / 2, duration / sceneFrameCount) : 0;

  return {
    durationSecs: duration,
    maxFrames: hardLimit,
    periodicIntervalSecs,
    periodicFrameCount,
    sceneFrameCount,
    endingFrameCount,
    minimumSceneGapSecs,
    estimatedFrameCount: periodicFrameCount + sceneFrameCount + endingFrameCount,
  };
}

export function createEndingSamplingPlan(
  durationSecs: number,
  maxAdditionalFrames: number,
): EndingSamplingPlan {
  const duration = Number.isFinite(durationSecs) ? Math.max(0, durationSecs) : 0;
  const capacity = Number.isFinite(maxAdditionalFrames)
    ? Math.max(0, Math.floor(maxAdditionalFrames))
    : 0;
  if (duration < 60 || capacity === 0) {
    return {
      startSecs: Math.max(0, duration - 90),
      intervalSecs: 5,
      frameCount: 0,
      timestamps: [],
    };
  }
  const windowSecs = Math.min(90, duration);
  const preferredIntervalSecs = duration <= 2 * 60 * 60 ? 5 : 15;
  const desiredFrameCount = Math.ceil(windowSecs / preferredIntervalSecs);
  const frameCount = Math.min(capacity, desiredFrameCount);
  const windowStart = Math.max(0, duration - windowSecs);
  const endSecs = Math.max(windowStart, duration - Math.min(1, preferredIntervalSecs));
  const hasFullCadence = frameCount === desiredFrameCount;
  const startSecs =
    frameCount === 1 ? Math.max(windowStart, duration - preferredIntervalSecs) : windowStart;
  const intervalSecs = hasFullCadence
    ? preferredIntervalSecs
    : frameCount > 1
    ? Math.max(1, (endSecs - startSecs) / (frameCount - 1))
    : preferredIntervalSecs;
  return {
    startSecs,
    intervalSecs,
    frameCount,
    timestamps: Array.from({ length: frameCount }, (_, index) => startSecs + index * intervalSecs),
  };
}

export async function processVideo(
  videoPath: string,
  options: VideoProcessOptions,
): Promise<VideoProcessResult> {
  await fs.mkdir(options.outputDir, { recursive: true });
  const framesDir = path.join(options.outputDir, 'frames');
  await fs.mkdir(framesDir, { recursive: true });

  const meta = await probeVideo(videoPath);

  const audioPath = path.join(options.outputDir, 'audio.wav');
  const interval = options.frameIntervalSecs ?? 10;
  const maxFrames = options.maxFrames ?? 100;
  let audioProgress = options.skipAudioExtraction ? 1 : 0;
  let frameProgress = 0;
  const reportExtractionProgress = () => {
    options.onProgress?.(
      options.skipAudioExtraction ? frameProgress : (audioProgress + frameProgress) / 2,
    );
  };

  const extractAudioPromise = options.skipAudioExtraction
    ? Promise.resolve({ path: undefined, error: undefined as string | undefined })
    : extractAudio(
        videoPath,
        audioPath,
        options.threads,
        (progress) => {
          audioProgress = Math.max(audioProgress, progress);
          reportExtractionProgress();
        },
        options.signal,
      )
        .then(() => {
          audioProgress = 1;
          reportExtractionProgress();
          return { path: audioPath, error: undefined };
        })
        .catch((error: unknown) => {
          audioProgress = 1;
          reportExtractionProgress();
          return {
            path: undefined,
            error: error instanceof Error ? error.message : 'Audio extraction failed.',
          };
        });
  const extractFramesPromise = extractChunkedSceneFrames(videoPath, {
    outputDir: framesDir,
    intervalSecs: interval,
    maxFrames,
    durationSecs: meta.durationSecs,
    sceneThreshold: options.sceneThreshold,
    threads: options.threads,
    chunkDurationSecs: options.chunkDurationSecs,
    onProgress: (progress) => {
      frameProgress = Math.max(frameProgress, progress);
      reportExtractionProgress();
    },
    signal: options.signal,
  });

  let frames: { path: string; timestampSecs: number }[];
  let extractedAudio: { path?: string; error?: string };
  if (options.parallelExtraction) {
    [extractedAudio, frames] = await Promise.all([extractAudioPromise, extractFramesPromise]);
  } else {
    extractedAudio = await extractAudioPromise;
    frames = await extractFramesPromise;
  }

  return {
    audioPath: extractedAudio.path,
    audioExtractionError: extractedAudio.error,
    frames,
    meta,
  };
}

/**
 * Keeps long recordings bounded by extracting one overlap-aware timeline chunk
 * at a time. Short videos retain the higher-fidelity shot-aware path.
 */
export async function extractChunkedSceneFrames(
  videoPath: string,
  options: Parameters<typeof extractSceneFrames>[1] & { chunkDurationSecs?: number },
): Promise<{ path: string; timestampSecs: number }[]> {
  const duration = options.durationSecs || (await probeVideo(videoPath)).durationSecs;
  const chunks = createTimelineChunkPlan(duration, options.chunkDurationSecs ?? 300);
  if (chunks.length <= 1) return extractSceneFrames(videoPath, options);
  await fs.mkdir(options.outputDir, { recursive: true });
  const plan = createVideoSamplingPlan(duration, options.intervalSecs, options.maxFrames);
  const output: { path: string; timestampSecs: number }[] = [];
  // Schedule coverage anchors globally, rather than giving the first chunks
  // all remaining capacity. The activity pass below must run across the
  // complete source even when the coverage budget is intentionally sparse.
  const periodicTimestamps = Array.from({ length: plan.periodicFrameCount }, (_, index) =>
    Math.min(Math.max(0, duration - 1), index * plan.periodicIntervalSecs),
  );
  for (const chunk of chunks) {
    const chunkDuration = Math.max(1, chunk.overlapEndSecs - chunk.overlapStartSecs);
    const chunkPeriodicTimestamps = periodicTimestamps.filter(
      (timestampSecs) =>
        timestampSecs >= chunk.startSecs &&
        (chunk.index === chunks.length - 1
          ? timestampSecs <= chunk.endSecs
          : timestampSecs < chunk.endSecs),
    );
    const frames =
      chunkPeriodicTimestamps.length > 0
        ? await extractFramesAtTimestamps(videoPath, chunkPeriodicTimestamps, {
            outputDir: path.join(
              options.outputDir,
              `chunk-${String(chunk.index).padStart(4, '0')}`,
            ),
            threads: options.threads,
            signal: options.signal,
            onProgress: (progress) =>
              options.onProgress?.((chunk.index + progress) / chunks.length),
          })
        : [];
    for (const frame of frames) {
      if (output.some((existing) => Math.abs(existing.timestampSecs - frame.timestampSecs) < 1))
        continue;
      output.push(frame);
    }
    // A coarse, low-resolution pass is the attention trigger for long
    // recordings. Unlike a shot-cut detector it reacts to sustained visual
    // change, so a mostly static view with a brief event can receive dense
    // evidence without decoding every source frame at vision-model cost.
    const activityAllocation = Math.max(
      1,
      Math.ceil((plan.sceneFrameCount * chunkDuration) / Math.max(1, duration)),
    );
    const activityFrames = await extractActivityFrames(videoPath, {
      outputDir: path.join(options.outputDir, `activity-${String(chunk.index).padStart(4, '0')}`),
      durationSecs: duration,
      startSecs: chunk.overlapStartSecs,
      endSecs: chunk.overlapEndSecs,
      maxFrames: activityAllocation,
      minGapSecs: Math.max(1, Math.min(10, plan.minimumSceneGapSecs / 4)),
      threads: options.threads,
      signal: options.signal,
    });
    for (const frame of activityFrames) {
      if (!output.some((existing) => Math.abs(existing.timestampSecs - frame.timestampSecs) < 1)) {
        output.push(frame);
      }
    }
  }
  const endingPlan = createEndingSamplingPlan(duration, plan.endingFrameCount);
  if (endingPlan.frameCount > 0) {
    output.push(
      ...(await extractFrames(videoPath, {
        outputDir: path.join(options.outputDir, 'ending'),
        intervalSecs: endingPlan.intervalSecs,
        maxFrames: endingPlan.frameCount,
        durationSecs: duration,
        startSecs: endingPlan.startSecs,
        threads: options.threads,
        signal: options.signal,
      })),
    );
  }
  options.onProgress?.(1);
  return selectExtractedFrames(
    output.sort((left, right) => left.timestampSecs - right.timestampSecs),
    plan,
  );
}

/**
 * Finds visually active moments at one decoded frame per second. It is an
 * attention signal only: no person/object/action is inferred here. The
 * subsequent vision stage sees the retained activity frames and can request a
 * bounded rewind when those anchors are insufficient.
 */
export async function extractActivityFrames(
  videoPath: string,
  options: ActivityProbeOptions,
): Promise<{ path: string; timestampSecs: number }[]> {
  if (options.maxFrames <= 0) return [];
  await fs.mkdir(options.outputDir, { recursive: true });
  const startSecs = Math.max(0, options.startSecs ?? 0);
  const endSecs = Math.max(
    startSecs,
    Math.min(options.durationSecs, options.endSecs ?? options.durationSecs),
  );
  const rangeDuration = Math.max(0, endSecs - startSecs);
  if (rangeDuration === 0) return [];
  const minGapSecs = Math.max(1, Math.min(60, options.minGapSecs ?? 2));
  const threshold = Math.max(0.001, Math.min(1, options.threshold ?? 0.015));
  const pattern = path.join(options.outputDir, 'activity_%04d.jpg');
  const timestamps: number[] = [];

  try {
    await runFfmpeg({
      args: [
        '-ss',
        String(startSecs),
        '-t',
        String(rangeDuration),
        '-i',
        videoPath,
        '-vf',
        `fps=1,scale='min(320,iw)':-2,select='gt(scene,${threshold})*if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${minGapSecs}))',showinfo`,
        '-vsync',
        'vfr',
        '-frames:v',
        String(Math.max(1, Math.floor(options.maxFrames))),
        ...(options.threads ? ['-threads', String(options.threads)] : []),
        pattern,
      ],
      durationSecs: rangeDuration,
      onStderr: (line) => {
        const match = line.match(/pts_time:([0-9.]+)/);
        if (match) timestamps.push(startSecs + Number(match[1]));
      },
      signal: options.signal,
    });
  } catch {
    // Activity scanning is an optimisation. Periodic anchors remain a safe,
    // explicitly lower-confidence fallback for codecs that reject this filter.
    return [];
  }
  const files = (await fs.readdir(options.outputDir))
    .filter((name) => /^activity_\d+\.jpg$/.test(name))
    .sort()
    .slice(0, options.maxFrames);
  return files.map((name, index) => ({
    path: path.join(options.outputDir, name),
    timestampSecs:
      timestamps.at(-files.length + index) ??
      startSecs + ((index + 1) * rangeDuration) / (files.length + 1),
  }));
}

export async function extractSceneFrames(
  videoPath: string,
  options: {
    outputDir: string;
    maxFrames: number;
    durationSecs?: number;
    intervalSecs?: number;
    sceneThreshold?: number;
    threads?: number;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  await fs.mkdir(options.outputDir, { recursive: true });
  const duration = options.durationSecs || (await probeVideo(videoPath)).durationSecs;
  const plan = createVideoSamplingPlan(duration, options.intervalSecs, options.maxFrames);
  const totalPlannedWork = Math.max(1, plan.estimatedFrameCount);
  const periodicWeight = plan.periodicFrameCount / totalPlannedWork;
  const sceneWeight = plan.sceneFrameCount / totalPlannedWork;
  const endingWeight = plan.endingFrameCount / totalPlannedWork;
  let reportedProgress = 0;
  const reportProgress = (progress: number) => {
    reportedProgress = Math.max(reportedProgress, Math.max(0, Math.min(1, progress)));
    options.onProgress?.(reportedProgress);
  };
  const addEndingEvidence = async (
    frames: { path: string; timestampSecs: number }[],
  ): Promise<{ path: string; timestampSecs: number }[]> => {
    const remaining = Math.max(0, plan.maxFrames - frames.length);
    const endingPlan = createEndingSamplingPlan(
      duration,
      Math.min(remaining, plan.endingFrameCount),
    );
    if (endingPlan.frameCount === 0) {
      reportProgress(1);
      return frames.slice(0, plan.maxFrames);
    }

    const endingFrames = await extractFrames(videoPath, {
      outputDir: path.join(options.outputDir, 'ending'),
      intervalSecs: endingPlan.intervalSecs,
      maxFrames: endingPlan.frameCount,
      durationSecs: duration,
      startSecs: endingPlan.startSecs,
      threads: options.threads,
      signal: options.signal,
      onProgress: (progress) =>
        reportProgress(periodicWeight + sceneWeight + progress * endingWeight),
    });
    const merged = [...frames, ...endingFrames].sort(
      (left, right) => left.timestampSecs - right.timestampSecs,
    );
    const result = merged
      .filter(
        (frame, index) =>
          index === 0 || Math.abs(frame.timestampSecs - merged[index - 1].timestampSecs) >= 1,
      )
      .slice(0, plan.maxFrames);
    reportProgress(1);
    return result;
  };

  const periodicFrames =
    plan.periodicFrameCount === 0
      ? []
      : duration >= 2 * 60 * 60
      ? await extractFramesAtTimestamps(
          videoPath,
          Array.from({ length: plan.periodicFrameCount }, (_, index) =>
            Math.min(Math.max(0, duration - 1), index * plan.periodicIntervalSecs),
          ),
          {
            outputDir: options.outputDir,
            threads: options.threads,
            signal: options.signal,
            onProgress: (progress) => reportProgress(progress * periodicWeight),
          },
        )
      : await extractFrames(videoPath, {
          outputDir: options.outputDir,
          intervalSecs: plan.periodicIntervalSecs,
          maxFrames: plan.periodicFrameCount,
          durationSecs: duration,
          threads: options.threads,
          signal: options.signal,
          onProgress: (progress) => reportProgress(progress * periodicWeight),
        });
  if (plan.sceneFrameCount === 0)
    return selectExtractedFrames(await addEndingEvidence(periodicFrames), plan);

  const threshold = options.sceneThreshold ?? 0.3;
  const sceneDir = path.join(options.outputDir, 'scenes');
  await fs.mkdir(sceneDir, { recursive: true });
  const pattern = path.join(sceneDir, 'scene_%04d.jpg');
  let timestamps: number[] = [];
  const isLongRecording = duration >= 2 * 60 * 60;
  const vf = isLongRecording
    ? `scale='min(640,iw)':-2,select='gt(scene,${threshold})*if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${plan.minimumSceneGapSecs}))',showinfo`
    : `select='gt(scene,${threshold})*if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${plan.minimumSceneGapSecs}))',showinfo,scale='min(1280,iw)':-2`;
  const sceneArgs = [
    ...(isLongRecording ? ['-skip_frame', 'nokey'] : []),
    '-i',
    videoPath,
    '-vf',
    vf,
    '-vsync',
    'vfr',
    '-frames:v',
    String(plan.sceneFrameCount),
    ...(options.threads ? ['-threads', String(options.threads)] : []),
    pattern,
  ];
  try {
    await runFfmpeg({
      args: sceneArgs,
      durationSecs: duration,
      onProgress: (percent) => {
        reportProgress(periodicWeight + percent * sceneWeight);
      },
      onStderr: (line) => {
        const match = line.match(/pts_time:([0-9.]+)/);
        if (match) timestamps.push(Number(match[1]));
      },
      signal: options.signal,
    });
  } catch {
    // Scene detection may fail on some codecs — continue with periodic frames
  }
  reportProgress(periodicWeight + sceneWeight);
  const files = (await fs.readdir(sceneDir))
    .filter((name) => /^scene_\d+\.jpg$/.test(name))
    .sort()
    .slice(0, plan.sceneFrameCount);
  if (!files.length) return selectExtractedFrames(await addEndingEvidence(periodicFrames), plan);
  timestamps = timestamps.slice(-files.length);
  const sceneFrames = files.map((name, index) => ({
    path: path.join(sceneDir, name),
    timestampSecs: timestamps[index] ?? (index * duration) / files.length,
  }));

  const merged = [...periodicFrames, ...sceneFrames].sort(
    (left, right) => left.timestampSecs - right.timestampSecs,
  );
  const deduplicated = merged.filter(
    (frame, index) =>
      index === 0 || Math.abs(frame.timestampSecs - merged[index - 1].timestampSecs) >= 1,
  );
  return selectExtractedFrames(await addEndingEvidence(deduplicated), plan);
}

function selectExtractedFrames(
  candidates: { path: string; timestampSecs: number }[],
  plan: VideoSamplingPlan,
): { path: string; timestampSecs: number }[] {
  const selected = selectFramesByInformationGain(
    candidates.map((frame, index) => {
      const isActivity = frame.path.includes(`${path.sep}activity-`);
      const isScene = frame.path.includes(`${path.sep}scenes${path.sep}`);
      const isEnding = frame.path.includes(`${path.sep}ending${path.sep}`);
      return {
        ...frame,
        // Periodic anchors are an explicit maximum-gap guarantee. They cannot
        // be displaced merely because an earlier activity frame was retained.
        protected:
          index === 0 || index === candidates.length - 1 || (!isActivity && !isScene && !isEnding),
        signals: {
          shotChange: isScene ? 1 : 0,
          // These frames came from the low-resolution activity pass. Giving the
          // cue both perceptual and motion weight prevents coarse coverage
          // anchors from consuming the whole budget before an active interval.
          perceptualChange: isActivity ? 1 : 0,
          // Periodic anchors protect coverage; ending samples are favored for
          // outcomes without making the endpoint the only source of truth.
          motionChange: isActivity ? 1 : isEnding ? 0.45 : 0,
        },
      };
    }),
    {
      maxFrames: plan.maxFrames,
      maximumCoverageGapSecs: Math.max(plan.periodicIntervalSecs, 1),
    },
  );
  return selected
    .filter((selection) => selection.decision !== 'dropped')
    .map((selection) => ({
      path: selection.candidate.path,
      timestampSecs: selection.candidate.timestampSecs,
    }));
}

async function extractFramesAtTimestamps(
  videoPath: string,
  timestamps: number[],
  options: {
    outputDir: string;
    threads?: number;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  await fs.mkdir(options.outputDir, { recursive: true });
  const results = new Array<{ path: string; timestampSecs: number }>(timestamps.length);
  let cursor = 0;
  let completed = 0;

  await Promise.all(
    Array.from({ length: Math.min(2, timestamps.length) }, async () => {
      while (cursor < timestamps.length) {
        const index = cursor++;
        const timestampSecs = timestamps[index];
        const outputPath = path.join(
          options.outputDir,
          `frame_${String(index + 1).padStart(4, '0')}.jpg`,
        );
        await runFfmpeg({
          args: [
            '-ss',
            String(timestampSecs),
            '-i',
            videoPath,
            '-vf',
            `scale='min(1280,iw)':-2`,
            '-frames:v',
            '1',
            ...(options.threads ? ['-threads', String(options.threads)] : []),
            outputPath,
          ],
          signal: options.signal,
        });
        results[index] = { path: outputPath, timestampSecs };
        completed += 1;
        options.onProgress?.(completed / timestamps.length);
      }
    }),
  );

  return results;
}

export async function extractFrames(
  videoPath: string,
  options: {
    outputDir: string;
    intervalSecs: number;
    maxFrames: number;
    durationSecs?: number;
    startSecs?: number;
    endSecs?: number;
    threads?: number;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  await fs.mkdir(options.outputDir, { recursive: true });

  let duration = options.durationSecs;
  if (!duration) {
    const meta = await probeVideo(videoPath);
    duration = meta.durationSecs;
  }

  const startSecs = Math.max(0, Math.min(options.startSecs ?? 0, duration));
  const endSecs = Math.max(startSecs, Math.min(options.endSecs ?? duration, duration));
  const rangeDuration = Math.max(0, endSecs - startSecs);
  const frameCount = Math.max(
    1,
    Math.min(Math.ceil(rangeDuration / options.intervalSecs), options.maxFrames),
  );
  const pattern = path.join(options.outputDir, 'frame_%04d.jpg');
  await runFfmpeg({
    args: [
      ...(startSecs > 0 ? ['-ss', String(startSecs)] : []),
      '-i',
      videoPath,
      ...(endSecs < duration ? ['-t', String(rangeDuration)] : []),
      '-vf',
      `select='if(isnan(prev_selected_t),1,gte(t-prev_selected_t,${options.intervalSecs}))',scale='min(1280,iw)':-2`,
      '-vsync',
      'vfr',
      '-frames:v',
      String(frameCount),
      ...(options.threads ? ['-threads', String(options.threads)] : []),
      pattern,
    ],
    durationSecs: rangeDuration,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  const files = (await fs.readdir(options.outputDir))
    .filter((name) => /^frame_\d+\.jpg$/.test(name))
    .sort()
    .slice(0, frameCount);
  return files.map((name, index) => ({
    path: path.join(options.outputDir, name),
    timestampSecs: startSecs + index * options.intervalSecs,
  }));
}

function extractAudio(
  videoPath: string,
  outputPath: string,
  threads?: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return runFfmpeg({
    args: [
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'wav',
      ...(threads ? ['-threads', String(threads)] : []),
      outputPath,
    ],
    onProgress,
    signal,
  });
}

interface VideoMeta {
  durationSecs: number;
  width: number;
  height: number;
  codec: string;
}

async function probeVideo(videoPath: string): Promise<VideoMeta> {
  const data = await ffprobe(videoPath);
  const videoStream = data.streams?.find((s) => s.codec_type === 'video');
  return {
    durationSecs: parseFloat(data.format?.duration ?? '0'),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    codec: videoStream?.codec_name ?? 'unknown',
  };
}

/* ------------------------------------------------------------------ */
/* Evidence-grade probe                                                */
/* ------------------------------------------------------------------ */

/**
 * Probe media metadata with full stream detail. Returns a typed
 * `MediaProbeResult` suitable for evidence persistence and budget
 * estimation.
 *
 * Unlike the internal `probeVideo`, this is a public export that
 * returns rotation, per-stream info, corruption signals, and
 * format-level metadata.
 */
export async function probeMedia(mediaPath: string): Promise<MediaProbeResult> {
  const data = await ffprobe(mediaPath);
  const videoStream = data.streams?.find((s) => s.codec_type === 'video');

  const streams: StreamInfo[] = (data.streams ?? []).map((s, index) => {
    const codecType = (s.codec_type ?? 'data') as StreamInfo['codecType'];
    const tags = s.tags as Record<string, string> | undefined;
    const rFrameRate = s.r_frame_rate as string | undefined;
    let fps: number | undefined;
    if (rFrameRate) {
      const [num, den] = rFrameRate.split('/').map(Number);
      if (num && den) fps = Math.round((num / den) * 100) / 100;
    }
    return {
      index,
      codecType,
      codecName: s.codec_name ?? 'unknown',
      width: codecType === 'video' ? s.width : undefined,
      height: codecType === 'video' ? s.height : undefined,
      fps: codecType === 'video' ? fps : undefined,
      sampleRate:
        codecType === 'audio'
          ? Number(s.sample_rate as string | undefined) || undefined
          : undefined,
      channels: codecType === 'audio' ? (s.channels as number | undefined) : undefined,
      language: tags?.language,
      durationSecs: s.duration ? parseFloat(String(s.duration)) : undefined,
    };
  });

  // Detect rotation from side-data or container tags.
  let rotation = 0;
  const sideData = (videoStream as any)?.side_data_list as Array<{ rotation?: number }> | undefined;
  if (sideData) {
    const rotEntry = sideData.find((sd) => sd.rotation !== undefined);
    if (rotEntry?.rotation !== undefined) rotation = Math.abs(rotEntry.rotation);
  }
  if (rotation === 0) {
    const tags = videoStream?.tags as Record<string, string> | undefined;
    const rotateTag = tags?.rotate;
    if (rotateTag) rotation = Math.abs(Number(rotateTag)) || 0;
  }

  // Corruption signals: negative duration, missing streams, or error flags.
  const rawDuration = parseFloat(data.format?.duration ?? '0');
  const hasCorruptionSignals =
    rawDuration <= 0 || (data.streams ?? []).length === 0 || (data.format as any)?.probe_score < 25;

  return {
    durationSecs: Math.max(0, rawDuration),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    codec: videoStream?.codec_name ?? 'unknown',
    rotation,
    videoStreamCount: streams.filter((s) => s.codecType === 'video').length,
    audioStreamCount: streams.filter((s) => s.codecType === 'audio').length,
    subtitleStreamCount: streams.filter((s) => s.codecType === 'subtitle').length,
    streams,
    hasCorruptionSignals,
    formatName: (data.format?.format_name as string) ?? 'unknown',
    bitRate: Number(data.format?.bit_rate) || undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Single-frame extraction                                             */
/* ------------------------------------------------------------------ */

/**
 * Extract a single frame at an exact timestamp. Used by the chat agent
 * to show "what was on screen at X:XX" — the agent's equivalent of
 * rewinding to a precise moment.
 *
 * Returns a `FrameArtifact` with the frame's path, timestamp, and
 * dimensions. The frame is always a JPEG.
 */
export async function extractFrameAtTimestamp(
  mediaPath: string,
  timestampSecs: number,
  options: FrameExtractionOptions,
): Promise<FrameArtifact> {
  await fs.mkdir(options.outputDir, { recursive: true });
  if (!Number.isFinite(timestampSecs)) throw new Error('Frame timestamp must be a finite number.');
  const maxWidth = Math.max(64, Math.min(1_920, Math.floor(options.maxWidth ?? 1280)));
  const clampedTimestamp = Math.max(0, timestampSecs);
  const outputPath = path.join(
    options.outputDir,
    `frame_${String(Math.round(clampedTimestamp * 1_000)).padStart(10, '0')}_${randomUUID()}.jpg`,
  );

  await runFfmpeg({
    args: [
      '-ss',
      String(clampedTimestamp),
      '-i',
      mediaPath,
      '-vf',
      `scale='min(${maxWidth},iw)':-2`,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      ...(options.threads ? ['-threads', String(options.threads)] : []),
      outputPath,
    ],
    signal: options.signal,
  });

  // Read actual dimensions from the extracted frame via ffprobe.
  let width = 0;
  let height = 0;
  try {
    const frameProbe = await ffprobe(outputPath);
    const frameStream = frameProbe.streams?.find((s) => s.codec_type === 'video');
    width = frameStream?.width ?? 0;
    height = frameStream?.height ?? 0;
  } catch {
    // Non-critical: dimensions default to 0 if ffprobe fails on the frame.
  }

  return {
    path: outputPath,
    timestampSecs: clampedTimestamp,
    timestampPrecision: 'estimated',
    width,
    height,
  };
}

/* ------------------------------------------------------------------ */
/* Bounded time-range inspection                                       */
/* ------------------------------------------------------------------ */

/**
 * Extract frames from a bounded time range for deeper analysis.
 * This is the tool-level primitive behind the online brain's
 * `inspectTimeRange` — it lets the agent "rewind" to a specific
 * window when knowledge is insufficient.
 *
 * The range is clamped to safe defaults: initially no more than
 * 30 seconds and 24 frames per the plan's inspection policy.
 */
export async function inspectTimeRange(request: InspectionRequest): Promise<InspectionResult> {
  if (!Number.isFinite(request.startSecs) || !Number.isFinite(request.endSecs)) {
    throw new Error('Inspection range timestamps must be finite numbers.');
  }
  if (!Number.isFinite(request.maxFrames))
    throw new Error('Inspection frame limit must be finite.');
  if (request.signal?.aborted) throw new Error('Inspection was cancelled.');
  const probe = await probeMedia(request.mediaPath);
  const duration = probe.durationSecs;

  // Clamp range to video bounds.
  const startSecs = Math.max(0, Math.min(request.startSecs, duration));
  const endSecs = Math.max(startSecs, Math.min(request.endSecs, duration));
  // Enforce safety limits from the plan's inspection policy.
  const maxDurationSecs = 30;
  const maxFrames = Math.max(0, Math.min(Math.floor(request.maxFrames), 24));
  const effectiveEnd = Math.min(endSecs, startSecs + maxDurationSecs);
  const effectiveDuration = effectiveEnd - startSecs;

  if (effectiveDuration <= 0 || maxFrames <= 0) {
    return {
      frames: [],
      actualRange: { startSecs, endSecs: effectiveEnd },
      probe,
    };
  }

  await fs.mkdir(request.outputDir, { recursive: true });
  const intervalSecs = maxFrames > 1 ? effectiveDuration / (maxFrames - 1) : effectiveDuration;
  const timestamps = Array.from({ length: maxFrames }, (_, i) =>
    Math.min(startSecs + i * intervalSecs, effectiveEnd),
  );

  // Extract frames at computed timestamps in parallel (bounded concurrency).
  const maxWidth = request.maxWidth ?? 1280;
  const frames: FrameArtifact[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, timestamps.length) }, async () => {
      while (cursor < timestamps.length) {
        const index = cursor++;
        const ts = timestamps[index];
        const frame = await extractFrameAtTimestamp(request.mediaPath, ts, {
          outputDir: request.outputDir,
          maxWidth,
          threads: request.threads,
          signal: request.signal,
        });
        frames[index] = frame;
      }
    }),
  );

  return {
    frames: frames.filter(Boolean).sort((a, b) => a.timestampSecs - b.timestampSecs),
    actualRange: { startSecs, endSecs: effectiveEnd },
    probe,
  };
}
