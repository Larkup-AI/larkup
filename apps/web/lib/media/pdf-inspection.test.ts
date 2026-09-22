import { describe, expect, it } from 'vitest';
import { selectInspectedPdfPages, selectRelevantPdfPages } from './pdf-inspection';

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

  it('prefers an exact numbered document reference over incidental number matches', () => {
    expect(
      selectRelevantPdfPages(
        [
          { num: 1, text: 'Section 5 contains an overview and many references to attention.' },
          { num: 2, text: 'Figure 5.1: Residual connections in the decoder architecture.' },
          { num: 3, text: 'Table 5.1 lists implementation values.' },
        ],
        'What do the orange dashed lines in Figure 5.1 mean?',
      )[0],
    ).toBe(2);
  });

  it('prefers the caption page over prose that only refers to a numbered visual', () => {
    expect(
      selectRelevantPdfPages(
        [
          { num: 15, text: 'The computational flow is illustrated in Figure 2.1.' },
          { num: 16, text: 'Figure 2.1: Computational flow of vectorized attention.' },
        ],
        'Render diagram 2.1',
      )[0],
    ).toBe(16);
  });

  it('returns the ranked full-text pages instead of the first pages in the PDF', () => {
    const pages = [
      { num: 1, text: 'Cover page.' },
      { num: 2, text: 'Introduction.' },
      { num: 8, text: 'Figure 2.1: Vectorized attention flow.' },
    ];
    expect(selectInspectedPdfPages(pages, [8, 2, 1]).map((page) => page.num)).toEqual([8, 2, 1]);
  });
});
