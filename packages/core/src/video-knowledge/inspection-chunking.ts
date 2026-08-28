/**
 * Splits a time range into chronological `<= maxChunkSecs` pieces. A single
 * bounded inspection request wider than `LIMITS.durationSecs`
 * (`inspection-policy.ts`) is always downgraded to `background-refinement`
 * by `decideInspection`, so any caller that wants a wider range inspected
 * synchronously (e.g. a 180s outcome tail window) must dispatch it as a
 * sequence of chunks this size or smaller instead of one request.
 */
export function chunkTimeRange(
  startSecs: number,
  endSecs: number,
  maxChunkSecs: number,
): Array<{ startSecs: number; endSecs: number }> {
  if (!(maxChunkSecs > 0) || !(endSecs > startSecs)) return [];
  const chunks: Array<{ startSecs: number; endSecs: number }> = [];
  for (let cursor = startSecs; cursor < endSecs; cursor += maxChunkSecs) {
    chunks.push({ startSecs: cursor, endSecs: Math.min(endSecs, cursor + maxChunkSecs) });
  }
  return chunks;
}
