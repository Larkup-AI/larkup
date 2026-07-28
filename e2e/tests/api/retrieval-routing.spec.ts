import { expect, test } from '@playwright/test';
import {
  requiresCurrentWebSearch,
  requiresKnowledgeBaseSearch,
  retrievalToolsForStep,
} from '../../../apps/web/lib/retrieval-routing';

const toolNames = ['searchKnowledgeBase', 'webSearch', 'analyzeImageDeeply', 'presentMedia'];

test.describe('Smart retrieval routing', () => {
  test('keeps private-index questions local first and exposes web as one fallback', () => {
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
    ).toEqual(['webSearch', 'analyzeImageDeeply', 'presentMedia']);
  });

  test('routes public match results to web first and retains local failure recovery', () => {
    expect(requiresKnowledgeBaseSearch('Who won the Egypt and Argentina match?')).toBe(false);
    expect(requiresCurrentWebSearch('Who won the Egypt and Argentina match?')).toBe(true);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: false,
        forceWebSearch: true,
        toolNames,
      }),
    ).toEqual({ toolChoice: { type: 'tool', toolName: 'webSearch' } });
    expect(
      retrievalToolsForStep({
        stepNumber: 1,
        forceKnowledgeBaseSearch: false,
        forceWebSearch: true,
        toolNames,
      })?.activeTools,
    ).toEqual(['searchKnowledgeBase', 'analyzeImageDeeply', 'presentMedia']);
  });

  test('does not make search tools available for ordinary conversation', () => {
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
