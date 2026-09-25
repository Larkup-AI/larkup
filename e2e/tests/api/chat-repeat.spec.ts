import { expect, test } from '@playwright/test';
import { assistantSourceScopeFingerprint } from '../../../apps/web/lib/chat/assistant-source-scope';

const projectIds: string[] = [];

test.afterAll(async ({ request }) => {
  for (const projectId of projectIds) {
    await request.delete(`/api/projects?id=${encodeURIComponent(projectId)}`);
  }
});

test('reuses an immediately repeated grounded answer without searching again', async ({
  request,
}) => {
  const createResponse = await request.post('/api/projects', {
    data: { name: 'Exact repeat cache test' },
  });
  expect(createResponse.ok()).toBe(true);
  const projectId = ((await createResponse.json()) as { project: { id: string } }).project.id;
  projectIds.push(projectId);

  const configResponse = await request.get(
    `/api/config?projectId=${encodeURIComponent(projectId)}`,
  );
  expect(configResponse.ok()).toBe(true);
  const config = ((await configResponse.json()) as { config: { updatedAt: string } }).config;
  const sourceScopeFingerprint = assistantSourceScopeFingerprint([], {
    configUpdatedAt: config.updatedAt,
  });

  const response = await request.post('/api/chat', {
    data: {
      projectId,
      messages: [
        {
          id: 'question-1',
          role: 'user',
          parts: [{ type: 'text', text: 'what is my fav anime' }],
        },
        {
          id: 'answer-1',
          role: 'assistant',
          metadata: { answerFeedback: 'liked' },
          parts: [
            {
              type: 'tool-searchKnowledgeBase',
              state: 'output-available',
              input: { query: 'what is my fav anime' },
              output: {
                sourceScopeFingerprint,
                hits: [
                  {
                    documentId: 'preferences',
                    title: 'Preferences',
                    text: 'Favorite anime: Naruto.',
                  },
                ],
              },
            },
            { type: 'text', text: 'Your favorite anime is Naruto.' },
          ],
        },
        {
          id: 'question-2',
          role: 'user',
          parts: [{ type: 'text', text: 'what is my fav anime' }],
        },
      ],
    },
  });

  const stream = await response.text();
  expect(response.ok(), stream).toBe(true);
  expect(stream).toContain('Your favorite anime is Naruto.');
  expect(stream).not.toContain('searchKnowledgeBase');
  expect(stream).not.toContain('tool-input');
});

test('liked grounded answers enter general cache and work in a new chat', async ({ request }) => {
  const createResponse = await request.post('/api/projects', {
    data: { name: 'Liked answer cache test' },
  });
  expect(createResponse.ok()).toBe(true);
  const projectId = ((await createResponse.json()) as { project: { id: string } }).project.id;
  projectIds.push(projectId);

  const beforeResponse = await request.get('/api/system/cache');
  const before = (await beforeResponse.json()) as {
    cache: {
      sizeBytes: number;
      answerFeedback: { likedEntries: number; dislikedEntries: number; sizeBytes: number };
    };
  };
  const feedbackResponse = await request.post('/api/chat/feedback', {
    data: {
      projectId,
      feedback: 'liked',
      question: 'what is my fav anime',
      answer: 'Your favorite anime is Naruto.',
    },
  });
  const feedbackBody = await feedbackResponse.json();
  expect(feedbackResponse.ok(), JSON.stringify(feedbackBody)).toBe(true);
  expect(feedbackBody).toMatchObject({ cached: true });

  const afterLikeResponse = await request.get('/api/system/cache');
  const afterLike = (await afterLikeResponse.json()) as typeof before;
  expect(afterLike.cache.sizeBytes).toBeGreaterThan(before.cache.sizeBytes);
  expect(afterLike.cache.answerFeedback.likedEntries).toBe(
    before.cache.answerFeedback.likedEntries + 1,
  );
  expect(afterLike.cache.answerFeedback.dislikedEntries).toBe(
    before.cache.answerFeedback.dislikedEntries,
  );

  const cachedChatResponse = await request.post('/api/chat', {
    data: {
      projectId,
      messages: [
        {
          id: 'new-chat-question',
          role: 'user',
          parts: [{ type: 'text', text: 'WHAT IS MY FAV ANIME' }],
        },
      ],
    },
  });
  const cachedStream = await cachedChatResponse.text();
  expect(cachedChatResponse.ok(), cachedStream).toBe(true);
  expect(cachedStream).toContain('Your favorite anime is Naruto.');
  expect(cachedStream).not.toContain('searchKnowledgeBase');
  expect(cachedStream).not.toContain('tool-input');

  const dislikeResponse = await request.post('/api/chat/feedback', {
    data: {
      projectId,
      feedback: 'disliked',
      question: 'what is my fav anime',
      answer: 'Your favorite anime is Naruto.',
    },
  });
  const dislikeBody = await dislikeResponse.json();
  expect(dislikeResponse.ok(), JSON.stringify(dislikeBody)).toBe(true);
  expect(dislikeBody).toMatchObject({ cached: false, feedbackStored: true });

  const afterDislikeResponse = await request.get('/api/system/cache');
  const afterDislike = (await afterDislikeResponse.json()) as typeof before;
  expect(afterDislike.cache.sizeBytes).toBeLessThan(afterLike.cache.sizeBytes);
  expect(afterDislike.cache.answerFeedback.likedEntries).toBe(
    before.cache.answerFeedback.likedEntries,
  );
  expect(afterDislike.cache.answerFeedback.dislikedEntries).toBe(
    before.cache.answerFeedback.dislikedEntries + 1,
  );

  const unlikeResponse = await request.post('/api/chat/feedback', {
    data: {
      projectId,
      question: 'what is my fav anime',
    },
  });
  const unlikeBody = await unlikeResponse.json();
  expect(unlikeResponse.ok(), JSON.stringify(unlikeBody)).toBe(true);
  expect(unlikeBody).toMatchObject({ cached: false, removed: true });

  const afterUnlike = (await (await request.get('/api/system/cache')).json()) as typeof before;
  expect(afterUnlike.cache.answerFeedback.likedEntries).toBe(
    before.cache.answerFeedback.likedEntries,
  );
  expect(afterUnlike.cache.answerFeedback.dislikedEntries).toBe(
    before.cache.answerFeedback.dislikedEntries,
  );
});
