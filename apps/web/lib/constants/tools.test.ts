import { describe, expect, it } from 'vitest';
import { getChatToolBehavior } from './tools';

describe('chat tool progress behavior', () => {
  it('keeps fast spreadsheet queries indeterminate', () => {
    expect(getChatToolBehavior('queryTabularData').showProgressBar).toBe(false);
  });

  it('keeps measurable long-running tool progress enabled by default', () => {
    expect(getChatToolBehavior('queryVideoKnowledge').showProgressBar).not.toBe(false);
  });
});
