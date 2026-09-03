import { describe, expect, it } from 'vitest';
import { selectRelevantPdfPages } from './pdf-inspection';

describe('selectRelevantPdfPages', () => {
  it('selects the pages nearest to the requested evidence without document-specific rules', () => {
    expect(
      selectRelevantPdfPages(
        [
          { num: 1, text: 'Overview and introduction.' },
          { num: 2, text: 'The dependency diagram has service and storage relationships.' },
          { num: 3, text: 'Appendix.' },
        ],
        'Explain the dependency relationships in the diagram',
      ),
    ).toEqual([2, 1, 3]);
  });

  it('uses a bounded fallback when the question has no searchable terms', () => {
    expect(
      selectRelevantPdfPages(
        [
          { num: 4, text: 'A' },
          { num: 5, text: 'B' },
        ],
        '?',
      ),
    ).toEqual([4, 5]);
  });
});
