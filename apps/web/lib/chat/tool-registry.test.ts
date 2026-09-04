import { describe, expect, it } from 'vitest';
import { executableTools } from './tool-registry';

describe('executableTools', () => {
  it('keeps available tools and removes missing optional capabilities', () => {
    const search = { type: 'function', execute: () => 'result' };
    expect(
      executableTools({
        searchKnowledgeBase: search,
        inspectPdfPages: undefined,
        analyzePdfPages: null,
      }),
    ).toEqual({ searchKnowledgeBase: search });
  });

  it('returns an empty registry when no capability is available', () => {
    expect(executableTools({ first: undefined, second: null })).toEqual({});
  });
});
