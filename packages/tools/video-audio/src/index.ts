export {
  processVideo,
  extractFrames,
  extractSceneFrames,
  createVideoSamplingPlan,
  createEndingSamplingPlan,
  buildMultimodalSegments,
  extractRunningState,
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
} from './url-importer.js';
export type {
  MultimodalSegment,
  TimedText,
  EndingSamplingPlan,
  VideoSamplingPlan,
  VideoProcessOptions,
  VideoProcessResult,
} from './video-processor.js';
export type {
  TranscriptChunk,
  TranscriptionOptions,
  TranscriptionOrigin,
  TranscriptionResult,
} from './audio-processor.js';
export type { ImportedMedia, MediaType, UrlImportOptions, UrlInspection } from './url-importer.js';

export const TOOL_META = {
  id: 'video-audio',
  name: 'Video & Audio',
  version: '0.1.0',
} as const;
