/**
 * Typed contracts for media-only extraction and analysis primitives.
 *
 * These interfaces define the boundary between the marketplace tool
 * (`@larkup/tool-video-audio`) and the rest of Larkup. They are
 * deliberately media-focused: the tool never imports Next.js, mutates
 * Larkup stores, or decides chat behavior.
 *
 * Any new tool following this contract pattern integrates automatically
 * with the marketplace loader and the web processing pipeline.
 */

/** How the source media was acquired. */
export type VideoSourceKind = 'local' | 'youtube' | 'remote-url';

/** Stream-level metadata for a single elementary stream. */
export interface StreamInfo {
  index: number;
  codecType: 'video' | 'audio' | 'subtitle' | 'data';
  codecName: string;
  width?: number;
  height?: number;
  /** Frames per second, if available. */
  fps?: number;
  /** Sample rate for audio streams. */
  sampleRate?: number;
  /** Channel count for audio streams. */
  channels?: number;
  /** Language tag (ISO 639-1/639-2) when the container supplies one. */
  language?: string;
  /** Stream duration in seconds, independent of the container duration. */
  durationSecs?: number;
}

/**
 * Structured result of `ffprobe`. This is evidence-grade metadata:
 * every field comes from the container/codec, not from inference.
 */
export interface MediaProbeResult {
  /** Container/format duration in seconds. */
  durationSecs: number;
  /** Video frame width (0 when no video stream). */
  width: number;
  /** Video frame height (0 when no video stream). */
  height: number;
  /** Primary video codec name (e.g. `h264`, `vp9`). */
  codec: string;
  /** Display rotation in degrees (from side-data or container metadata). */
  rotation: number;
  /** Number of video streams. */
  videoStreamCount: number;
  /** Number of audio streams. */
  audioStreamCount: number;
  /** Number of subtitle streams. */
  subtitleStreamCount: number;
  /** Per-stream details. */
  streams: StreamInfo[];
  /** Whether the container or any stream shows signs of corruption. */
  hasCorruptionSignals: boolean;
  /** Container format name (e.g. `mov,mp4,m4a,3gp,3g2,mj2`). */
  formatName: string;
  /** Container-level bit rate in bits/second. */
  bitRate?: number;
}

/** One bounded, overlap-aware unit of media work. */
export interface TimelineChunk {
  index: number;
  startSecs: number;
  endSecs: number;
  overlapStartSecs: number;
  overlapEndSecs: number;
}

/** A single extracted frame with its provenance. */
export interface FrameArtifact {
  /** Local, worker-only path to the extracted JPEG. Never persist or expose it. */
  path: string;
  /** Requested source timestamp in seconds. */
  timestampSecs: number;
  /** Seeking normally lands on a decoder frame; callers must not overstate this as an exact source PTS. */
  timestampPrecision: 'frame' | 'estimated';
  /** Frame width. */
  width: number;
  /** Frame height. */
  height: number;
}

/** Options for extracting a single frame at a precise timestamp. */
export interface FrameExtractionOptions {
  /** Output directory for the frame JPEG. */
  outputDir: string;
  /** Maximum output width (maintains aspect ratio). Defaults to 1280. */
  maxWidth?: number;
  /** FFmpeg thread count. */
  threads?: number;
  /** Cancels FFmpeg when the job, request, or inspection budget is cancelled. */
  signal?: AbortSignal;
}

/** Full extraction result: audio, frames, and probe metadata. */
export interface ExtractionResult {
  /** Path to the extracted WAV audio. `undefined` when no audio track. */
  audioPath?: string;
  /** Extracted frame artifacts sorted by timestamp. */
  frames: FrameArtifact[];
  /** Probe-level metadata. */
  probe: MediaProbeResult;
}

/** Purpose of a source inspection request. */
export type InspectionPurpose =
  | 'verify-visual'
  | 'high-res-ocr'
  | 'compare'
  | 'count'
  | 'track'
  | 'code';

/** Input for a bounded time-range inspection. */
export interface InspectionRequest {
  /** Absolute path to the source media file. */
  mediaPath: string;
  /** Start of the inspection range (seconds). */
  startSecs: number;
  /** End of the inspection range (seconds). */
  endSecs: number;
  /** Why this inspection is requested. */
  purpose: InspectionPurpose;
  /** Maximum number of frames to extract in this range. */
  maxFrames: number;
  /** Maximum output width for extracted frames. */
  maxWidth?: number;
  /** Output directory. */
  outputDir: string;
  /** FFmpeg thread count. */
  threads?: number;
  signal?: AbortSignal;
}

/** Result of a bounded source inspection. */
export interface InspectionResult {
  /** Frames extracted in the inspection range. */
  frames: FrameArtifact[];
  /** The bounded time range that was actually inspected. */
  actualRange: { startSecs: number; endSecs: number };
  /** Probe metadata (re-used from the initial probe when available). */
  probe: MediaProbeResult;
}

/**
 * The public contract that any media extraction tool must implement.
 * The marketplace loader returns an object satisfying this interface.
 *
 * This keeps the system expandable: a future `tool-advanced-video`
 * can implement the same contract with different internals.
 */
export interface MediaToolContract {
  /** Probe media metadata without expensive processing. */
  probeMedia: (mediaPath: string) => Promise<MediaProbeResult>;

  /** Extract a single frame at a specific timestamp. */
  extractFrameAtTimestamp: (
    mediaPath: string,
    timestampSecs: number,
    options: FrameExtractionOptions,
  ) => Promise<FrameArtifact>;

  /** Bounded source inspection: decode a narrow time range. */
  inspectTimeRange: (request: InspectionRequest) => Promise<InspectionResult>;
}
