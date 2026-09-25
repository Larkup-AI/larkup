import { describe, expect, it } from 'vitest';
import {
  answerFeedbackForMessage,
  groundedAnswerFeedbackContext,
  updateAnswerFeedback,
  withAnswerFeedback,
} from './message-feedback';

describe('chat answer feedback', () => {
  it('stores feedback without replacing other message metadata', () => {
    const message = withAnswerFeedback(
      { id: 'answer-1', metadata: { provider: 'local' } },
      'liked',
    );

    expect(message.metadata).toEqual({ provider: 'local', answerFeedback: 'liked' });
    expect(answerFeedbackForMessage(message)).toBe('liked');
  });

  it('can switch or clear one message rating immutably', () => {
    const messages = [
      { id: 'answer-1', metadata: { answerFeedback: 'liked' } },
      { id: 'answer-2', metadata: { answerFeedback: 'liked' } },
    ];
    const disliked = updateAnswerFeedback(messages, 'answer-1', 'disliked');
    const cleared = updateAnswerFeedback(disliked, 'answer-1', undefined);

    expect(answerFeedbackForMessage(disliked[0])).toBe('disliked');
    expect(answerFeedbackForMessage(disliked[1])).toBe('liked');
    expect(answerFeedbackForMessage(cleared[0])).toBeUndefined();
    expect(messages[0].metadata.answerFeedback).toBe('liked');
  });

  it('extracts an eligible grounded answer from current and legacy search results', () => {
    expect(
      groundedAnswerFeedbackContext(
        [
          { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Favorite anime?' }] },
          {
            id: 'answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-searchKnowledgeBase',
                output: {
                  hits: [{ documentId: 'preferences', text: 'Naruto' }],
                  sourceScopeFingerprint: 'scope-1',
                },
              },
              { type: 'text', text: 'Naruto.' },
            ],
          },
        ],
        'answer',
      ),
    ).toEqual({
      question: 'Favorite anime?',
      answer: 'Naruto.',
      sourceScopeFingerprint: 'scope-1',
    });

    expect(
      groundedAnswerFeedbackContext(
        [
          { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Favorite anime?' }] },
          {
            id: 'answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-searchKnowledgeBase',
                output: { hits: [{ documentId: 'preferences', text: 'Naruto' }] },
              },
              { type: 'text', text: 'Naruto.' },
            ],
          },
        ],
        'answer',
      )?.answer,
    ).toBe('Naruto.');
  });

  it('does not cache media or multi-tool answers through generic feedback', () => {
    const base = [
      { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Who won?' }] },
      {
        id: 'answer',
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledgeBase',
            output: {
              hits: [{ metadata: { mediaAssetId: 'video-1' }, text: 'A clip' }],
            },
          },
          { type: 'text', text: 'The red team.' },
        ],
      },
    ];
    expect(groundedAnswerFeedbackContext(base, 'answer')).toBeUndefined();
  });
});
