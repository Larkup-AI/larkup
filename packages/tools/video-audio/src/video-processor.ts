import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ffprobe, runFfmpeg } from './ffmpeg-spawn.js';

export interface VideoProcessResult {
  audioPath?: string;
  frames: { path: string; timestampSecs: number }[];
  meta: {
    durationSecs: number;
    width: number;
    height: number;
    codec: string;
  };
}

export interface VideoProcessOptions {
  outputDir: string;
  frameIntervalSecs?: number;
  maxFrames?: number;
  sceneThreshold?: number;
  threads?: number;
  parallelExtraction?: boolean;
  skipAudioExtraction?: boolean;
  onProgress?: (progress: number) => void;
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
    ? Promise.resolve(undefined)
    : extractAudio(videoPath, audioPath, options.threads, (progress) => {
        audioProgress = Math.max(audioProgress, progress);
        reportExtractionProgress();
      })
        .then(() => {
          audioProgress = 1;
          reportExtractionProgress();
          return audioPath;
        })
        .catch(() => {
          audioProgress = 1;
          reportExtractionProgress();
          return undefined;
        });
  const extractFramesPromise = extractSceneFrames(videoPath, {
    outputDir: framesDir,
    intervalSecs: interval,
    maxFrames,
    durationSecs: meta.durationSecs,
    sceneThreshold: options.sceneThreshold,
    threads: options.threads,
    onProgress: (progress) => {
      frameProgress = Math.max(frameProgress, progress);
      reportExtractionProgress();
    },
  });

  let frames: { path: string; timestampSecs: number }[];
  let extractedAudioPath: string | undefined;
  if (options.parallelExtraction) {
    [extractedAudioPath, frames] = await Promise.all([extractAudioPromise, extractFramesPromise]);
  } else {
    extractedAudioPath = await extractAudioPromise;
    frames = await extractFramesPromise;
  }

  return { audioPath: extractedAudioPath, frames, meta };
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
            onProgress: (progress) => reportProgress(progress * periodicWeight),
          },
        )
      : await extractFrames(videoPath, {
          outputDir: options.outputDir,
          intervalSecs: plan.periodicIntervalSecs,
          maxFrames: plan.periodicFrameCount,
          durationSecs: duration,
          threads: options.threads,
          onProgress: (progress) => reportProgress(progress * periodicWeight),
        });
  if (plan.sceneFrameCount === 0) return addEndingEvidence(periodicFrames);

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
    });
  } catch {
    // Scene detection may fail on some codecs — continue with periodic frames
  }
  reportProgress(periodicWeight + sceneWeight);
  const files = (await fs.readdir(sceneDir))
    .filter((name) => /^scene_\d+\.jpg$/.test(name))
    .sort()
    .slice(0, plan.sceneFrameCount);
  if (!files.length) return addEndingEvidence(periodicFrames);
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
  return addEndingEvidence(deduplicated);
}

async function extractFramesAtTimestamps(
  videoPath: string,
  timestamps: number[],
  options: {
    outputDir: string;
    threads?: number;
    onProgress?: (progress: number) => void;
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
    threads?: number;
    onProgress?: (progress: number) => void;
  },
): Promise<{ path: string; timestampSecs: number }[]> {
  await fs.mkdir(options.outputDir, { recursive: true });

  let duration = options.durationSecs;
  if (!duration) {
    const meta = await probeVideo(videoPath);
    duration = meta.durationSecs;
  }

  const startSecs = Math.max(0, Math.min(options.startSecs ?? 0, duration));
  const rangeDuration = Math.max(0, duration - startSecs);
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
