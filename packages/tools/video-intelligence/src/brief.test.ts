import { describe, expect, it } from 'vitest';
import { createVideoIndexingBrief } from './brief';

describe('createVideoIndexingBrief', () => {
  it('provides privacy-preserving balanced defaults', () => {
    expect(createVideoIndexingBrief()).toMatchObject({
      contentType: 'general',
      indexingMode: 'balanced',
      processingAuthorityConfirmed: false,
      retainSourceHours: 0,
    });
  });

  it('normalizes repeated guidance and bounds retention', () => {
    const brief = createVideoIndexingBrief({
      goal: '  Follow the red car  ',
      knownEntities: ['Red car', 'Red car', '  Driver '],
      retainSourceHours: 2_000,
    });
    expect(brief.goal).toBe('Follow the red car');
    expect(brief.knownEntities).toEqual(['Red car', 'Driver']);
    expect(brief.retainSourceHours).toBe(720);
  });
});
