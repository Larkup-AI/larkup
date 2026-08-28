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
