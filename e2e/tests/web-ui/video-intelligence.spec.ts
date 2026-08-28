import { expect, test } from '@playwright/test';

test.describe('Video Intelligence', () => {
  test('renders manifest-driven runtimes and provider branding', async ({ page }) => {
    await page.route('**/api/marketplace', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            {
              id: 'video-intelligence',
              name: 'Video Intelligence',
              description: 'Timestamped video evidence.',
              emoji: '🎥',
              status: 'installed',
              usage: { label: 'Usage this month', fields: [] },
              runtime: {
                defaultMode: 'managed-cloud',
                modes: [
                  { id: 'managed-cloud', label: 'Larkup Cloud', description: 'Managed GPU.' },
                  {
                    id: 'local-docker',
                    label: 'Local Docker runtime',
                    icon: '/docker.png',
                    description: 'Local.',
                    setupNotice: 'The optional runtime image is about 8 GB.',
                  },
                  { id: 'custom-remote', label: 'Custom runtime', description: 'Remote.' },
                ],
              },
              configSchema: [
                {
                  key: 'runtimeMode',
                  label: 'Runtime',
                  type: 'select',
                  defaultValue: 'managed-cloud',
                  options: [
                    { label: 'Larkup Cloud', value: 'managed-cloud', icon: '/logo.png' },
                    { label: 'Local Docker runtime', value: 'local-docker', icon: '/docker.png' },
                    { label: 'Custom runtime', value: 'custom-remote' },
                  ],
                },
                {
                  key: 'audioProvider',
                  label: 'Audio provider',
                  type: 'select',
                  defaultValue: 'larkup-cloud',
                  visibleWhen: { field: 'runtimeMode', equals: 'managed-cloud' },
                  options: [
                    { label: 'Larkup Cloud', value: 'larkup-cloud', icon: '/icons/audio.png' },
                    { label: 'OpenAI', value: 'openai', icon: '/icons/openai.svg' },
                  ],
                },
                {
                  key: 'audioApiKey',
                  label: 'Audio provider API key',
                  type: 'password',
                  verification: {
                    endpoint: '/api/config/verify',
                    fields: { audioProvider: 'audioProvider', audioApiKey: 'audioApiKey' },
                  },
                  visibleWhen: { field: 'audioProvider', equals: ['openai'] },
                },
                {
                  key: 'localRuntimeUrl',
                  label: 'Local runtime URL',
                  type: 'text',
                  defaultValue: 'http://127.0.0.1:8787',
                  verification: {
                    endpoint: '/api/tools/video-intelligence/verify',
                    fields: { localRuntimeUrl: 'localRuntimeUrl', runtimeMode: 'runtimeMode' },
                  },
                  visibleWhen: { field: 'runtimeMode', equals: 'local-docker' },
                },
                {
                  key: 'localRuntimeApiKey',
                  label: 'Shared local API key',
                  type: 'password',
                  visibleWhen: { field: 'runtimeMode', equals: 'local-docker' },
                },
              ],
            },
          ],
        }),
      }),
    );
    await page.route('**/api/config**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          config: {
            toolConfigs: {
              'video-intelligence': { runtimeMode: 'managed-cloud', audioProvider: 'larkup-cloud' },
            },
          },
        }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/runtime', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'connected',
          display: { userId: 'user_123', apiKey: 'lvi_1234••••abcd' },
        }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/usage', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }),
    );
    await page.route('**/api/tools/video-intelligence/verify', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Could not connect. Check the selected runtime and access key.',
        }),
      }),
    );

    await page.goto('/settings?section=tool-settings');

    await expect(page.getByText('Larkup Cloud connected')).toBeVisible();
    await expect(page.getByText(/User ID: user_123/)).toBeVisible();
    await expect(page.locator('img[src="/logo.png"]')).toBeVisible();

    await page.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: /OpenAI/ })).toBeVisible();
    await expect(page.locator('img[src="/icons/openai.svg"]')).toBeVisible();
    await page.getByRole('option', { name: /OpenAI/ }).click();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Local Docker runtime' }).click();
    await expect(page.getByRole('dialog', { name: 'Local Docker runtime' })).toBeVisible();
    await expect(page.getByText('Audio provider')).toHaveCount(0);
    await expect(
      page.getByRole('combobox').first().locator('img[src="/docker.png"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Local runtime URL').fill('http://127.0.0.1:65534');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(
      page.getByText('Could not connect. Check the selected runtime and access key.'),
    ).toBeVisible();
  });

  test('collects an optional indexing brief and explicit full-frame authority', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
        configurable: true,
        get: () => 2,
      });
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        get() {
          return source?.get?.call(this) ?? '';
        },
        set(value: string) {
          source?.set?.call(this, value);
          queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
        },
      });
    });
    await page.route('**/api/index', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ unindexedCount: 0, running: false, run: null, blockers: [] }),
      });
    });
    await page.route('**/api/marketplace', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            {
              id: 'video-intelligence',
              name: 'Video Intelligence',
              status: 'installed',
              manifestVersion: '3.0',
            },
          ],
        }),
      }),
    );
    await page.route('**/api/config**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          config: {
            enabledTools: ['video-intelligence'],
            toolConfigs: { 'video-intelligence': { runtimeMode: 'managed-cloud' } },
          },
        }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/usage', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sourceMinutesUsed: 48,
          sourceMinutesLimit: 60,
          activeJobs: 0,
          concurrentJobsLimit: 1,
        }),
      }),
    );

    await page.goto('/add?subtab=media');
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'brief-test.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from('video-fixture'),
      });

    await expect(page.getByText('Video Intelligence allowance is nearly used')).toBeVisible();
    await page.getByRole('button', { name: 'Request more usage' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Request more video capacity' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();

    await page.getByText('Guide video indexing', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Guide video indexing' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByPlaceholder('For example: follow the score, final result, and disputed goals.')
      .fill('Track the score and final result.');
    await dialog.locator('select').selectOption('sports');
    await dialog.getByPlaceholder('Team A, red car, scoreboard').fill('Team A, scoreboard');
    await dialog.getByPlaceholder(/One question per line/).fill('What was the final score?');

    const fullFrame = dialog.getByRole('switch', { name: 'Analyze every frame' });
    await fullFrame.click();
    await expect(fullFrame).toBeChecked();
    await expect(dialog.locator('input[type="range"]')).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Upload and index' })).toBeEnabled();
  });

  test('labels a video re-index action as video even when the Images tab is open', async ({
    page,
  }) => {
    const videoAsset = {
      id: 'completed-video',
      type: 'video',
      fileName: 'final-score.mp4',
      mimeType: 'video/mp4',
      storageUri: 'local://videos/final-score.mp4',
      fileSize: 1_024,
      durationSecs: 90,
      processingStatus: 'completed',
      documentIds: [],
      createdAt: new Date().toISOString(),
    };
    await page.route('**/api/marketplace', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            { id: 'video-intelligence', name: 'Video Intelligence', status: 'installed' },
            { id: 'video-audio', name: 'Video & Audio', status: 'installed' },
          ],
        }),
      }),
    );
    await page.route('**/api/config**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ config: {} }) }),
    );
    await page.route('**/api/media?type=all*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          assets: [videoAsset],
          stats: { total: 1, byType: { video: 1 }, byStatus: { completed: 1 }, totalBytes: 1024 },
          storage: { usedBytes: 1024, fileCount: 1 },
        }),
      }),
    );
    await page.route('**/api/media/process', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ queued: true }) }),
    );

    await page.goto('/add?subtab=media');
    await page.getByRole('button', { name: 'View Uploads' }).click();
    const dialog = page.getByRole('dialog', { name: 'Uploaded media' });
    await dialog.getByRole('button', { name: /Video 1/ }).click();
    await dialog.getByRole('button', { name: 'Re-index' }).click();

    await expect(page.getByText('Video indexing started')).toBeVisible();
  });
});
