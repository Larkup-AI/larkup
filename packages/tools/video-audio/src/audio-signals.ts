import type { TranscriptChunk } from './audio-processor.js';

export interface AudioSignal {
  timestampSecs: number;
  transcriptChange: number;
  silenceBoundary: boolean;
}

/** Cheap chronological transcript signals for information-gain candidate ranking. */
export function deriveAudioSignals(chunks: TranscriptChunk[], silenceGapSecs = 2): AudioSignal[] {
  const result: AudioSignal[] = [];
  let previous: TranscriptChunk | undefined;
  for (const chunk of [...chunks].sort((left, right) => left.startSecs - right.startSecs)) {
    const previousWords = new Set(
      (previous?.text ?? '').toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [],
    );
    const words = new Set(chunk.text.toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? []);
    const novel = [...words].filter((word) => !previousWords.has(word)).length;
    const transcriptChange = words.size === 0 ? 0 : Math.min(1, novel / words.size);
    const silenceBoundary = Boolean(
      previous && chunk.startSecs - previous.endSecs >= silenceGapSecs,
    );
    result.push({ timestampSecs: chunk.startSecs, transcriptChange, silenceBoundary });
    previous = chunk;
  }
  return result;
}
