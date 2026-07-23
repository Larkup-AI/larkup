/**
 * @larkup/tool-video-audio
 *
 * Marketplace tool for indexing video and audio files.
 * Extracts transcripts, keyframes, and scene descriptions.
 */

export {
  processVideo,
  extractFrames,
  extractSceneFrames,
  buildMultimodalSegments,
} from './video-processor.js';
export { processAudio, transcribeAudio } from './audio-processor.js';
export { importMediaUrl, inspectMediaUrl, parseYouTubeJson3Transcript } from './url-importer.js';
export type {
  MultimodalSegment,
  TimedText,
  VideoProcessOptions,
  VideoProcessResult,
} from './video-processor.js';
export type {
  TranscriptChunk,
  TranscriptionOptions,
  TranscriptionResult,
} from './audio-processor.js';
export type { ImportedMedia, MediaType, UrlImportOptions, UrlInspection } from './url-importer.js';

/** Tool metadata for the marketplace loader. */
export const TOOL_META = {
  id: 'video-audio',
  name: 'Video & Audio',
  version: '0.1.0',
} as const;
