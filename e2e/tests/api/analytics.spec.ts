import { test, expect } from '@playwright/test';

test.describe('Analytics API', () => {
  test('GET /api/analytics returns valid summary structure', async ({ request }) => {
    const response = await request.get('/api/analytics?timeframe=all');
    expect(response.status()).toBe(200);

    const summary = await response.json();

    // Check that all expected properties exist
    expect(summary).toHaveProperty('totalChatTokens');
    expect(summary).toHaveProperty('totalEmbeddingTokens');
    expect(summary).toHaveProperty('totalCost');
    expect(summary).toHaveProperty('totalRequests');
    expect(summary).toHaveProperty('chatTimeSeries');
    expect(summary).toHaveProperty('embeddingTimeSeries');
    expect(summary).toHaveProperty('serverTimeSeries');
    expect(summary).toHaveProperty('modelBreakdown');

    // Verify arrays
    expect(Array.isArray(summary.chatTimeSeries)).toBeTruthy();
    expect(Array.isArray(summary.embeddingTimeSeries)).toBeTruthy();
    expect(Array.isArray(summary.serverTimeSeries)).toBeTruthy();
    expect(Array.isArray(summary.modelBreakdown)).toBeTruthy();
  });

  test('GET /api/analytics respects timeframe parameter', async ({ request }) => {
    const response7d = await request.get('/api/analytics?timeframe=7d');
    expect(response7d.status()).toBe(200);
    const data7d = await response7d.json();
    expect(data7d).toBeDefined();

    const response30d = await request.get('/api/analytics?timeframe=30d');
    expect(response30d.status()).toBe(200);
    const data30d = await response30d.json();
    expect(data30d).toBeDefined();
  });
});
