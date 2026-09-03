/**
 * Returns only source-bearing text for retrieval. Inspection readers echo the
 * user's question and their verdict protocol after the actual observation;
 * indexing that envelope makes an old miss look more relevant than the source
 * evidence that answers the question.
 */
export function evidenceTextForRetrieval(payload: unknown): string {
  const text = (payload as { text?: unknown } | undefined)?.text;
  if (typeof text === 'string') {
    return text
      .split(/\r?\n/)
      .filter((line) => !/^\s*(?:claim question|claim verdict|uncertainty)\s*:/iu.test(line))
      .join('\n')
      .trim();
  }
  if (text && typeof text === 'object') return JSON.stringify(text);
  return '';
}

export function evidenceClaimVerdict(
  payload: unknown,
): 'direct' | 'partial' | 'not-established' | undefined {
  const text = (payload as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string') return undefined;
  const verdict = text.match(/^\s*Claim verdict:\s*(direct|partial|not-established)\s*$/imu)?.[1];
  return verdict as 'direct' | 'partial' | 'not-established' | undefined;
}
