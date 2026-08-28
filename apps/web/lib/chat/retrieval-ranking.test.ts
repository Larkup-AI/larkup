import { describe, expect, it } from 'vitest';
import { rankKnowledgeHits } from './retrieval-ranking';

describe('rankKnowledgeHits', () => {
  it('does not let a query term match as a fragment inside a longer word', () => {
    // Regression: a plain substring check let "day" match inside "Tuesday"
    // and "color" match inside "Colored", which caused a long, unrelated
    // document to systematically outrank a short, genuinely on-topic one
    // (observed live: an indexed video transcript naming "Tuesday" and
    // "Colored Canyon" tourism copy neither of which mention a video).
    const hits = [
      {
        title: 'video clip',
        text: 'A red drone crash-landed into a blue pool on Tuesday afternoon in Austin.',
      },
      {
        title: 'unrelated tourism page',
        text: 'The Colored Canyon is a natural wonder. It is a great day out for the family.',
      },
    ];
    // Dense rank 0 is the video clip (the correct, highest vector-similarity
    // match); the ranker must not flip that order just because the second
    // document's word fragments happen to contain "color" and "day".
    const ranked = rankKnowledgeHits('video crash details color landing day city', hits);
    expect(ranked[0].title).toBe('video clip');
  });

  it('still rewards a real whole-word match in a short document over a longer one', () => {
    const hits = [
      { title: 'unrelated page', text: 'Some long unrelated document about many other topics.' },
      { title: 'video clip', text: 'A drone crash landed in a pool on a sunny day.' },
    ];
    const ranked = rankKnowledgeHits('what day did the drone crash', hits);
    expect(ranked[0].title).toBe('video clip');
  });

  it('still matches an ordinary plural/possessive form of a query term', () => {
    // Regression: the word-boundary fix above initially rejected "views"
    // as a match for the term "view" (a real, pre-existing e2e test
    // exercised this: a query for "view" and "routine" needed to match a
    // doc naming "Views" and "routines"). Ordinary English inflection is
    // not the same failure mode as "day" inside "Tuesday" -- only the
    // second should be rejected.
    const hits = [
      { title: 'unrelated', text: 'Nothing relevant here at all, just filler words.' },
      { title: 'schema doc', text: 'Views: film_list. Resources contains routines: get_customer.' },
    ];
    const ranked = rankKnowledgeHits('list every view and routine under Resources', hits);
    expect(ranked[0].title).toBe('schema doc');
  });

  it('preserves dense-rank order when no hit has any keyword overlap', () => {
    const hits = [{ title: 'first', text: 'alpha' }, { title: 'second', text: 'beta' }];
    const ranked = rankKnowledgeHits('completely unrelated query terms', hits);
    expect(ranked.map((hit) => hit.title)).toEqual(['first', 'second']);
  });

  it('is a no-op for fewer than two hits', () => {
    const hits = [{ title: 'only', text: 'one hit' }];
    expect(rankKnowledgeHits('query', hits)).toEqual(hits);
  });
});
