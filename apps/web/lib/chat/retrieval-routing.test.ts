import { describe, expect, it } from 'vitest';
import { requiresKnowledgeBaseSearch, retrievalToolsForStep } from './retrieval-routing';

const TOOL_NAMES = ['searchKnowledgeBase', 'webSearch', 'presentMedia'] as const;

describe('requiresKnowledgeBaseSearch', () => {
  it('matches a possessive noun with a modifier word in between', () => {
    // Regression: the underlying regexes required "my"/"this"/"the" to sit
    // directly next to the noun (\s+ only). "my test video" has "test" in
    // between and fell through every branch, silently skipping the forced
    // search step -- observed live: the model answered "no video content"
    // instead of searching, even though the video was indexed and findable.
    expect(
      requiresKnowledgeBaseSearch(
        'Where did the drone in my test video end up, and when did it happen?',
      ),
    ).toBe(true);
    expect(requiresKnowledgeBaseSearch('What does this uploaded recording show?')).toBe(true);
    expect(requiresKnowledgeBaseSearch('Summarize the quarterly sales report')).toBe(true);
  });

  it('still matches the direct-adjacency phrasing with no modifier', () => {
    expect(requiresKnowledgeBaseSearch('What happens in my video?')).toBe(true);
    expect(requiresKnowledgeBaseSearch('Show me the document')).toBe(true);
  });

  it('does not match across an unbounded number of intervening words', () => {
    expect(
      requiresKnowledgeBaseSearch(
        'my extremely long winded description of a totally unrelated video',
      ),
    ).toBe(false);
  });

  it('does not flag an ordinary greeting', () => {
    expect(requiresKnowledgeBaseSearch('Hey, how are you?')).toBe(false);
  });
});

describe('retrievalToolsForStep', () => {
  it('forces searchKnowledgeBase on step 0 when required', () => {
    const step = retrievalToolsForStep({
      stepNumber: 0,
      forceKnowledgeBaseSearch: true,
      forceWebSearch: false,
      toolNames: TOOL_NAMES,
    });
    expect(step?.toolChoice).toEqual({ type: 'tool', toolName: 'searchKnowledgeBase' });
    expect(step?.activeTools).toEqual(['searchKnowledgeBase']);
  });

  it('explicitly disables tool choice on the final answer step instead of leaving a stale auto', () => {
    // Regression: an empty activeTools array paired with the top-level
    // streamText toolChoice ('auto') left over from earlier in the request
    // produced a degenerate near-empty model response (observed live: 1
    // output token, no text) instead of a normal final answer. Being
    // explicit here removes the ambiguity for the provider.
    const step = retrievalToolsForStep({
      stepNumber: 2,
      forceKnowledgeBaseSearch: true,
      forceWebSearch: false,
      toolNames: TOOL_NAMES,
      finalAnswerStep: 2,
    });
    expect(step?.activeTools).toEqual([]);
    expect(step?.toolChoice).toBe('none');
  });

  it('does not force a final-answer step before finalAnswerStep is reached', () => {
    const step = retrievalToolsForStep({
      stepNumber: 1,
      forceKnowledgeBaseSearch: true,
      forceWebSearch: false,
      toolNames: TOOL_NAMES,
      finalAnswerStep: 2,
    });
    expect(step?.toolChoice).toBeUndefined();
    expect(step?.activeTools).toEqual(['presentMedia']);
  });
});
