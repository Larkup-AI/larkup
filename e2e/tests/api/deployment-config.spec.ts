import { test, expect } from '@playwright/test';

test.describe.serial('Deployment Config API', () => {
  test('should return default config initially', async ({ request }) => {
    // Reset config to ensure parallel execution doesn't bleed state
    await request.put('/api/deployment/config', {
      data: {
        type: 'rag-only',
        authMode: 'none',
        enabledToolIds: [],
        widgetStyle: {
          primaryColor: '#000000',
          position: 'bottom-right',
          title: 'Chat with AI',
          welcomeMessage: 'Hi! How can I help you today?',
          placeholder: 'Type a message...',
          darkMode: false,
          borderRadius: 'lg',
        },
        allowedOrigins: ['*'],
      },
    });

    const res = await request.get('/api/deployment/config');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.type).toBe('rag-only');
    expect(data.authMode).toBe('none');
  });

  test('should save and return updated config', async ({ request }) => {
    // Save new config
    const updateRes = await request.put('/api/deployment/config', {
      data: {
        type: 'full-agent',
        authMode: 'api-key',
        widgetStyle: {
          primaryColor: '#123456',
          title: 'Custom Agent',
        },
      },
    });

    expect(updateRes.ok()).toBeTruthy();

    // Fetch it back
    const getRes = await request.get('/api/deployment/config');
    const data = await getRes.json();

    expect(data.type).toBe('full-agent');
    expect(data.authMode).toBe('api-key');
    expect(data.widgetStyle.primaryColor).toBe('#123456');
    expect(data.widgetStyle.title).toBe('Custom Agent');
  });
});
