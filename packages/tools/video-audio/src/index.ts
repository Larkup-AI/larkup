/**
 * @larkup/tool-video-audio
 *
 * Marketplace tool for indexing video and audio files.
 * Extracts transcripts, keyframes, and scene descriptions.
 */

export { processVideo, extractFrames } from './video-processor';
export { processAudio, transcribeAudio } from './audio-processor';

/** Tool metadata for the marketplace loader. */
export const TOOL_META = {
  id: 'video-audio',
  name: 'Video & Audio',
  version: '0.1.0',
} as const;
