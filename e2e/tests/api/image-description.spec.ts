import { expect, test } from '@playwright/test';
import {
  createImageDescriptionSignal,
  IMAGE_DESCRIPTION_TIMEOUT_MS,
  isImageDescriptionAbort,
} from '../../../apps/web/lib/chat/image-description';

test.describe('Image-description request lifecycle', () => {
  test('uses an independent, bounded provider signal instead of a caller signal', () => {
    const caller = new AbortController();
    caller.abort();

    const providerSignal = createImageDescriptionSignal();
    expect(caller.signal.aborted).toBe(true);
    expect(providerSignal.aborted).toBe(false);
    expect(IMAGE_DESCRIPTION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  test('recognizes aborted AI SDK retry delays as recoverable timeouts', () => {
    expect(isImageDescriptionAbort(new DOMException('Delay was aborted', 'AbortError'))).toBe(true);
    expect(isImageDescriptionAbort(new Error('Vision provider unavailable'))).toBe(false);
  });
});
