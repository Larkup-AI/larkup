/**
 * Ambient type declaration for the optional `nodejs-whisper` module.
 *
 * This dependency is NOT installed by default — it's only needed when
 * the user selects "Local Whisper" as the transcription provider.
 * The dynamic import in audio-processor.ts catches the missing module
 * at runtime and provides a helpful error message.
 */
declare module 'nodejs-whisper' {
  interface WhisperOptions {
    modelName?: string;
    autoDownloadModelName?: string;
    whisperOptions?: {
      outputInText?: boolean;
      outputInVtt?: boolean;
      outputInSrt?: boolean;
      outputInCsv?: boolean;
      translateToEnglish?: boolean;
      wordTimestamps?: boolean;
      language?: string;
    };
  }

  export function nodewhisper(audioPath: string, options: WhisperOptions): Promise<string>;
}
