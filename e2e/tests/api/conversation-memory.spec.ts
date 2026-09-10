import { expect, test } from '@playwright/test';
import {
  extractConversationEvidence,
  contextualizeKnowledgeFollowUpQuery,
  formatConversationEvidence,
  isImagePreviewFollowUp,
  isTabularFollowUp,
} from '../../../apps/web/lib/chat/conversation-memory';

test('retains a compact prior PDF image reference for a preview follow-up', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchKnowledgeBase',
          output: {
            type: 'json',
            value: {
              hits: [
                {
                  title: 'Database Design Overview',
                  text: 'A'.repeat(2_000),
                  images: [
                    {
                      imageUrl: '/api/documents/demo/image-2.png',
                      pageNumber: 2,
                      index: 1,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
    { role: 'user', parts: [{ type: 'text', text: 'show me image preview' }] },
  ]);

  expect(evidence.images).toEqual([
    {
      imageUrl: '/api/documents/demo/image-2.png',
      pageNumber: 2,
      index: 1,
      title: 'Database Design Overview',
    },
  ]);
  expect(isImagePreviewFollowUp('show me image preview', evidence)).toBe(true);
  expect(isImagePreviewFollowUp('show me diagram preview', evidence)).toBe(true);
  expect(formatConversationEvidence(evidence)).toContain('/api/documents/demo/image-2.png');
  expect(formatConversationEvidence(evidence)).toContain('A'.repeat(600));
});

test('uses the completed search result when an earlier tool part is incomplete', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [{ type: 'tool-searchKnowledgeBase' }],
      toolInvocations: [
        {
          toolName: 'searchKnowledgeBase',
          result: { hits: [{ title: 'Preferences', text: 'Favorite character: Kakashi Hatake.' }] },
        },
      ],
    },
  ]);

  expect(evidence.sources).toEqual([
    { title: 'Preferences', text: 'Favorite character: Kakashi Hatake.' },
  ]);
});

test('keeps an unmentioned event follow-up scoped to its immediately preceding source', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchKnowledgeBase',
          output: {
            hits: [
              {
                title: 'NVIDIA GTC AI Conference Berlin',
                text: 'The event takes place in October 2026 and covers AI infrastructure.',
              },
            ],
          },
        },
      ],
    },
  ]);

  const retrievalQuery = contextualizeKnowledgeFollowUpQuery('What will it be about?', evidence);
  expect(retrievalQuery).toContain('NVIDIA GTC AI Conference Berlin');
  expect(retrievalQuery).toContain('AI infrastructure');
});

test('does not let a secondary video result replace the leading event topic', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-searchKnowledgeBase',
          output: {
            hits: [
              {
                title: 'NVIDIA GTC AI Conference Berlin',
                text: 'The event is in October 2026.',
              },
              {
                title: 'Football highlights',
                text: 'Spain plays Argentina.',
                metadata: { mediaAssetId: 'unrelated-video' },
              },
            ],
          },
        },
      ],
    },
  ]);

  expect(evidence.mediaAssetIds).toEqual([]);
  expect(contextualizeKnowledgeFollowUpQuery('What will it be about?', evidence)).toContain(
    'NVIDIA GTC AI Conference Berlin',
  );
});

test('reuses the table just shown for a misspelled comparative follow-up', () => {
  const evidence = extractConversationEvidence([
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-queryTabularData',
          input: { datasetId: 'sales-data' },
          output: {
            columns: ['Region', 'Net Revenue'],
            rows: [
              { Region: 'North', 'Net Revenue': 720000 },
              { Region: 'East', 'Net Revenue': 530000 },
              { Region: 'South', 'Net Revenue': 800000 },
              { Region: 'West', 'Net Revenue': 720000 },
            ],
            totalRows: 4,
          },
        },
      ],
    },
    { role: 'assistant', parts: [{ type: 'text', text: 'Distribution by Region.' }] },
  ]);

  expect(evidence.tabular).toMatchObject({ datasetId: 'sales-data', totalRows: 4 });
  expect(isTabularFollowUp('what was the begisst area?', evidence)).toBe(true);
  expect(formatConversationEvidence(evidence)).toContain('"South"');
});
