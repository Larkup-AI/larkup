import { expect, test } from '@playwright/test';
import {
  requiresCurrentWebSearch,
  requiresKnowledgeBaseSearch,
  retrievalToolsForStep,
} from '../../../apps/web/lib/retrieval-routing';

const toolNames = ['searchKnowledgeBase', 'webSearch', 'analyzeImageDeeply', 'presentMedia'];

test.describe('Retrieval-only chat routing', () => {
  test('keeps private-index questions local first and never exposes web fallback', () => {
    expect(requiresKnowledgeBaseSearch('What fruit do I like in my indexed notes?')).toBe(true);
    expect(requiresCurrentWebSearch('What fruit do I like in my indexed notes?')).toBe(false);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      }),
    ).toEqual({ toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' } });
    expect(
      retrievalToolsForStep({
        stepNumber: 1,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      })?.activeTools,
    ).toEqual(['analyzeImageDeeply', 'presentMedia']);
  });

  test('routes named match results to the knowledge base', () => {
    const question = 'Who won the Argentina Egypt match and what was the score?';
    expect(requiresKnowledgeBaseSearch(question)).toBe(true);
    expect(requiresCurrentWebSearch(question)).toBe(false);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      }),
    ).toEqual({ toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' } });
    expect(
      retrievalToolsForStep({
        stepNumber: 1,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      })?.activeTools,
    ).toEqual(['analyzeImageDeeply', 'presentMedia']);
  });

  test('does not expose web search for ordinary conversation', () => {
    expect(requiresKnowledgeBaseSearch('Hello, can you make this sentence friendlier?')).toBe(
      false,
    );
    expect(requiresCurrentWebSearch('Hello, can you make this sentence friendlier?')).toBe(false);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: false,
        forceWebSearch: false,
        toolNames,
      })?.activeTools,
    ).toEqual(['analyzeImageDeeply', 'presentMedia']);
  });
});
