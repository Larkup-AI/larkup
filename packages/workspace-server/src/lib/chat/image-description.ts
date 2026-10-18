/**
 * Image descriptions are often requested by a background media job. Their
 * provider request must not inherit the browser or internal fetch signal: an
 * outer request can finish/retry while the provider is waiting to retry a
 * rate-limited call, which otherwise aborts the AI SDK's retry delay.
 */
export const IMAGE_DESCRIPTION_TIMEOUT_MS = 90_000;

export function createImageDescriptionSignal(): AbortSignal {
  return AbortSignal.timeout(IMAGE_DESCRIPTION_TIMEOUT_MS);
}

export function isImageDescriptionAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { name?: string; code?: number; message?: string };
  return (
    details.name === 'AbortError' ||
    details.code === 20 ||
    /(?:delay was )?aborted/i.test(details.message ?? '')
  );
}
