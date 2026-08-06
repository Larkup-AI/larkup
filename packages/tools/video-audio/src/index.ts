export {
  processVideo,
  extractFrames,
  extractSceneFrames,
  extractChunkedSceneFrames,
  extractActivityFrames,
  createVideoSamplingPlan,
  createEndingSamplingPlan,
  createTimelineChunkPlan,
  buildMultimodalSegments,
  extractRunningState,
  probeMedia,
  extractFrameAtTimestamp,
  inspectTimeRange,
} from './video-processor.js';
export {
  buildDeepgramTranscriptionUrl,
  inferLanguageHintFromText,
  processAudio,
  transcribeAudio,
} from './audio-processor.js';
export {
  importMediaUrl,
  inspectMediaUrl,
  parseYouTubeJson3Transcript,
  ensureManagedYtDlp,
  getManagedYtDlpPath,
  getManagedYtDlpAssetName,
  getManagedYtDlpDownloadUrl,
} from './url-importer.js';
export type {
  MultimodalSegment,
  TimedText,
  EndingSamplingPlan,
  VideoSamplingPlan,
  VideoProcessOptions,
  VideoProcessResult,
  ActivityProbeOptions,
} from './video-processor.js';
export type {
  TranscriptChunk,
  TranscriptionOptions,
  TranscriptionOrigin,
  TranscriptionResult,
} from './audio-processor.js';
export type { ImportedMedia, MediaType, UrlImportOptions, UrlInspection } from './url-importer.js';
export type { OcrAdapter, OcrBlock, OcrResult } from './ocr.js';
export { validateOcrResult } from './ocr.js';
export type {
  VisionAnalysisAdapter,
  VisualObservationCandidate,
  VisualObservationKind,
} from './vision-analysis.js';
export { validateVisualObservations } from './vision-analysis.js';
export { selectFramesByInformationGain } from './frame-selector.js';
export type { FrameCandidate, FrameSelection } from './frame-selector.js';
export { deriveAudioSignals } from './audio-signals.js';
export type { AudioSignal } from './audio-signals.js';
export { createArtifactCacheKey } from './artifact-cache.js';
export type { ArtifactCacheKeyInput } from './artifact-cache.js';
export { inspectBoundedSource } from './source-inspector.js';
export type { BoundedSourceInspectionRequest } from './source-inspector.js';
export type {
  VideoSourceKind,
  StreamInfo,
  MediaProbeResult,
  FrameArtifact,
  FrameExtractionOptions,
  ExtractionResult,
  InspectionPurpose,
  InspectionRequest,
  InspectionResult,
  MediaToolContract,
  TimelineChunk,
} from './contracts.js';

export const TOOL_META = {
  id: 'video-audio',
  name: 'Video Intelligence',
  version: '0.4.0',
} as const;
