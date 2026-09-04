import { expect, test } from '@playwright/test';

test.describe('Video Intelligence', () => {
  test('shows locally cached media URLs when the URL field is focused', async ({ page }) => {
    const recentUrl = 'https://example.com/previous-demo.mp4';
    await page.addInitScript((url) => {
      localStorage.setItem('media_recent_urls', JSON.stringify([url]));
    }, recentUrl);

    await page.goto('/add?subtab=media');
    await page.getByRole('button', { name: 'From URL' }).click();

    const input = page.getByLabel('Import media URL');
    await input.focus();
    await expect(page.getByText('Recent URLs')).toBeVisible();
    await expect(page.getByText(recentUrl, { exact: true })).toBeVisible();

    await page.getByText(recentUrl, { exact: true }).click();
    await expect(input).toHaveValue(recentUrl);

    await input.focus();
    await page.getByRole('button', { name: `Remove ${recentUrl} from recent URLs` }).click();
    await expect(page.getByText(recentUrl, { exact: true })).not.toBeVisible();
  });

  test('estimates and imports only the selected video from a playlist watch URL', async ({
    page,
  }) => {
    const playlistUrl = 'https://www.youtube.com/watch?v=chosen-video&list=long-playlist&index=16';
    let importedUrls: string[] | undefined;
    let importedGroupId: string | undefined;
    const selectedGroup = { id: 'video-e2e-group', name: 'Video E2E group', icon: '◆' };

    await page.route('**/api/marketplace', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            {
              id: 'video-intelligence',
              name: 'Video Intelligence',
              status: 'installed',
              ui: {
                surfaces: [
                  {
                    id: 'video-indexing-brief',
                    slot: 'data-indexing',
                    title: 'Let your AI understand this video',
                    appliesTo: ['video'],
                    estimate: {
                      modeField: 'indexingMode',
                      variants: [
                        {
                          value: 'fast',
                          analyzedFramesPerSourceMinute: 5,
                          ocrFramesPerSourceMinute: 3,
                          processingSecondsPerSourceMinute: 4,
                          maxProcessingSecondsPerSourceMinute: 5,
                          fixedOverheadSeconds: 60,
                          maxFixedOverheadSeconds: 60,
                          creditsPerSourceMinute: 1,
                        },
                      ],
                    },
                    form: {
                      submitLabel: 'Start indexing',
                      fields: [
                        {
                          key: 'indexingMode',
                          type: 'select',
                          label: 'Coverage',
                          defaultValue: 'fast',
                          options: [{ label: 'Fast', value: 'fast' }],
                        },
                      ],
                    },
                  },
                ],
              },
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
    await page.route('**/api/documents', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          documents: [],
          groups: [
            {
              id: 'default',
              name: 'Default',
              icon: '📚',
              assistantEnabled: true,
            },
            { ...selectedGroup, assistantEnabled: true },
          ],
          stats: { docCount: 0, charCount: 0, bySource: {} },
        }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/usage**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sourceMinutesUsed: 0,
          sourceMinutesLimit: 10_000,
          activeJobs: 0,
          concurrentJobsLimit: 1,
        }),
      }),
    );
    await page.route(/\/api\/media(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            assets: [],
            stats: { total: 0, byType: {}, byStatus: {}, totalBytes: 0 },
            storage: { usedBytes: 0, fileCount: 0 },
          }),
        });
        return;
      }
      const body = route.request().postDataJSON() as {
        estimateOnly?: boolean;
        urls?: string[];
        groupId?: string;
      };
      if (body.estimateOnly) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            estimates: [
              {
                originalUrl: playlistUrl,
                title: 'Selected match inside a long playlist',
                durationSecs: 87_540,
                singleItemDurationSecs: 3_600,
                singleItemUrl: 'https://www.youtube.com/watch?v=chosen-video',
                entryCount: 24,
                mediaType: 'video',
                isYouTube: true,
              },
            ],
          }),
        });
        return;
      }
      importedUrls = body.urls;
      importedGroupId = body.groupId;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          assets: [
            {
              id: 'selected-video',
              type: 'video',
              fileName: 'Importing URL...',
              processingStatus: 'pending',
            },
          ],
          count: 1,
        }),
      });
    });
    await page.route('**/api/media/process', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ queued: true }) }),
    );

    await page.goto('/add?subtab=media');
    await page.getByRole('button', { name: 'From URL' }).click();
    await page.getByRole('textbox', { name: 'Import media URL' }).fill(playlistUrl);
    await page.getByRole('button', { name: 'Check URL' }).click();
    await page.getByLabel('Data group').click();
    await page.getByText(selectedGroup.name, { exact: true }).click();
    await page.getByRole('button', { name: 'Add media', exact: true }).click();
    await page.getByRole('button', { name: 'Single Video' }).click();

    const dialog = page.getByRole('dialog', { name: 'Let your AI understand this video' });
    await expect(dialog.getByText('~5–6 min')).toBeVisible();
    await expect(dialog.getByText('~60', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Start indexing' }).click();
    await expect.poll(() => importedUrls).toEqual(['https://www.youtube.com/watch?v=chosen-video']);
    expect(importedGroupId).toBe(selectedGroup.id);
  });

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
              usage: {
                label: 'Usage this month',
                visualization: { usedKey: 'sourceMinutesUsed', limitKey: 'sourceMinutesLimit' },
                support: {
                  contactLabel: 'Request more usage',
                  userIdConfigKey: 'cloudInstallationId',
                },
                fields: [
                  { key: 'sourceMinutesUsed', label: 'Used', format: 'minutes' },
                  { key: 'sourceMinutesLimit', label: 'Included', format: 'minutes' },
                ],
              },
              runtime: {
                defaultMode: 'managed-cloud',
                modes: [
                  { id: 'managed-cloud', label: 'Larkup Cloud', description: 'Managed GPU.' },
                  {
                    id: 'local',
                    label: 'Local runtime',
                    description: 'Auto-detect Docker or native.',
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
                    { label: 'Local runtime', value: 'local' },
                    { label: 'Custom runtime', value: 'custom-remote' },
                  ],
                },
                {
                  key: 'audioProvider',
                  label: 'Audio provider',
                  type: 'select',
                  defaultValue: 'larkup-cloud',
                  visibleWhen: { field: 'runtimeMode', equals: ['managed-cloud', 'local'] },
                  options: [
                    { label: 'Local transcription', value: 'local', icon: '/logo.png' },
                    { label: 'Larkup Cloud', value: 'larkup-cloud', icon: '/icons/audio.png' },
                    { label: 'OpenAI', value: 'openai', icon: '/icons/openai.svg' },
                  ],
                },
                {
                  key: 'videoVisionProvider',
                  label: 'Vision provider',
                  type: 'select',
                  defaultValue: 'auto',
                  visibleWhen: { field: 'runtimeMode', equals: 'local' },
                  options: [{ label: 'Use AI Models', value: 'auto' }],
                },
                {
                  key: 'semanticVisionModel',
                  label: 'Video vision model',
                  type: 'select',
                  defaultValue: 'auto',
                  verification: {
                    endpoint: '/api/tools/video-intelligence/verify',
                    fields: {
                      videoVisionProvider: 'videoVisionProvider',
                      semanticVisionModel: 'semanticVisionModel',
                    },
                  },
                  visibleWhen: { field: 'runtimeMode', equals: 'local' },
                  options: [{ label: 'Use AI Models vision model', value: 'auto' }],
                },
                {
                  key: 'videoAgentProvider',
                  label: 'Agent provider',
                  type: 'select',
                  defaultValue: 'auto',
                  visibleWhen: { field: 'runtimeMode', equals: 'local' },
                  options: [{ label: 'Use AI Models', value: 'auto' }],
                },
                {
                  key: 'agentModel',
                  label: 'Agent / tool-brain model',
                  type: 'select',
                  defaultValue: 'auto',
                  verification: {
                    endpoint: '/api/tools/video-intelligence/verify',
                    fields: { agentModel: 'agentModel' },
                  },
                  visibleWhen: { field: 'runtimeMode', equals: 'local' },
                  options: [{ label: 'Use AI Models chat model', value: 'auto' }],
                },
                {
                  key: 'cloudAccessKey',
                  label: 'Larkup Cloud API key',
                  type: 'password',
                  visibleWhen: { field: 'runtimeMode', equals: 'managed-cloud' },
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
                  visibleWhen: { field: 'runtimeMode', equals: 'local' },
                },
                {
                  key: 'localRuntimeApiKey',
                  label: 'Shared local API key',
                  type: 'password',
                  visibleWhen: { field: 'runtimeMode', equals: 'local' },
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
              'video-intelligence': {
                runtimeMode: 'managed-cloud',
                audioProvider: 'larkup-cloud',
                cloudInstallationId: 'device_123',
              },
            },
          },
        }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/runtime**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'connected',
          display: { userId: 'user_123', apiKey: 'lvi_1234••••abcd' },
        }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/usage**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sourceMinutesUsed: 4, sourceMinutesLimit: 5 }),
      }),
    );
    await page.route('**/api/tools/video-intelligence/usage-request', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'sent' }) }),
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
    await page.route('**/api/tools/video-intelligence/host**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          docker: { cliInstalled: true, daemonRunning: true, imagePulled: false },
          native: { uvInstalled: true, depsInstalled: false },
          recommendedKind: 'local-docker',
          installed: false,
          running: false,
          suitability: { level: 'good', message: '8 GB RAM free.' },
          system: { platform: 'darwin', cpus: 8, totalMemGB: 16, freeMemGB: 8 },
          modelRequirement: {
            configured: false,
            message: 'Video understanding needs an AI Gateway key and a vision model.',
          },
        }),
      }),
    );

    await page.goto('/settings?section=tool-settings');

    await expect(page.getByLabel('Larkup Cloud connected')).toBeVisible();
    await expect(page.getByLabel('Larkup Cloud user ID')).toHaveValue('user_123');
    await expect(page.getByRole('button', { name: 'Copy user ID' })).toBeVisible();
    await expect(page.getByText(/API key:/)).toHaveCount(0);
    await expect(page.getByLabel(/80 percent of monthly allowance used/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Larkup Cloud API key' })).toBeVisible();
    await page.getByRole('button', { name: 'Request more usage' }).click();
    await expect(page.getByRole('dialog', { name: 'Request more usage' })).toBeVisible();
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('combobox').first().locator('img[src="/logo.png"]')).toBeVisible();

    await page.getByRole('combobox', { name: 'Audio provider' }).click();
    await expect(page.getByRole('option', { name: /OpenAI/ })).toBeVisible();
    await expect(page.locator('img[src="/icons/openai.svg"]')).toBeVisible();
    await page.getByRole('option', { name: /OpenAI/ }).click();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Runtime' }).click();
    await page.getByRole('option', { name: 'Local runtime' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Use the local GPU runtime?' }),
    ).not.toBeVisible();
    await expect(page.getByText('Audio provider', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Vision provider' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Video vision model' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify Video vision model' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Verify Agent / tool-brain model' }),
    ).toBeVisible();
    await expect(page.locator('img[src="/docker.png"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install local runtime' })).toBeVisible();
    await page.getByRole('button', { name: 'Install local runtime' }).click();
    await expect(
      page.getByRole('alertdialog', { name: 'Install local GPU runtime?' }),
    ).toBeVisible();
    await expect(page.getByText(/CUDA-capable NVIDIA GPU/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('textbox', { name: 'Local runtime URL' }).fill('http://127.0.0.1:65534');
    await page.getByRole('button', { name: 'Verify Local runtime URL' }).click();
    await expect(
      page.getByText('Could not connect. Check the selected runtime and access key.').first(),
    ).toBeVisible();
  });

  test('collects an optional indexing brief and remembers recent media URLs', async ({ page }) => {
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
              ui: {
                surfaces: [
                  {
                    id: 'video-indexing-brief',
                    slot: 'data-indexing',
                    title: 'Let your AI understand this video',
                    appliesTo: ['video'],
                    estimate: {
                      modeField: 'indexingMode',
                      variants: [
                        {
                          value: 'balanced',
                          analyzedFramesPerSourceMinute: 6,
                          ocrFramesPerSourceMinute: 6,
                          processingSecondsPerSourceMinute: 18,
                          creditsPerSourceMinute: 2,
                        },
                        {
                          value: 'full-coverage',
                          analyzedFramesPerSourceMinute: 1800,
                          ocrFramesPerSourceMinute: 1800,
                          processingSecondsPerSourceMinute: 300,
                          creditsPerSourceMinute: 24,
                        },
                      ],
                    },
                    form: {
                      submitLabel: 'Upload and index',
                      fields: [
                        {
                          key: 'goal',
                          type: 'textarea',
                          label: 'What are you looking for?',
                          placeholder: 'Describe what matters in this video',
                        },
                        {
                          key: 'indexingMode',
                          type: 'select',
                          label: 'Coverage',
                          defaultValue: 'balanced',
                          options: [
                            {
                              label: 'Balanced',
                              value: 'balanced',
                              setValues: { processingAuthorityConfirmed: false },
                            },
                            {
                              label: 'Full coverage',
                              value: 'full-coverage',
                              setValues: { processingAuthorityConfirmed: true },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
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
    await page.route('**/api/tools/video-intelligence/usage**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sourceMinutesUsed: 48,
          sourceMinutesLimit: 60,
          // Simulate SWR briefly retaining the previous job after the local
          // media card has already reached a terminal state.
          activeJobs: 1,
          concurrentJobsLimit: 1,
        }),
      }),
    );

    await page.addInitScript(() => {
      localStorage.setItem(
        'media_recent_urls',
        JSON.stringify(['https://example.com/last-video.mp4']),
      );
    });
    await page.goto('/add?subtab=media');
    await page.getByRole('button', { name: 'From URL' }).click();
    const urlInput = page.getByRole('textbox', { name: 'Import media URL' });
    await urlInput.focus();
    await expect(page.getByText('Recent URLs')).toBeVisible();
    await page.getByText('https://example.com/last-video.mp4').click();
    await expect(urlInput).toHaveValue('https://example.com/last-video.mp4');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
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

    await page.getByRole('button', { name: 'Add media' }).click();
    const dialog = page.getByRole('dialog', { name: 'Let your AI understand this video' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByPlaceholder('Describe what matters in this video')
      .fill('Track the score and final result.');
    await expect(dialog.getByPlaceholder('Describe what matters in this video')).toHaveAttribute(
      'rows',
      '5',
    );
    await dialog.locator('select').selectOption('full-coverage');
    await expect(dialog.getByText('Typical range')).toBeVisible();
    await expect(dialog.getByText('Estimated credits')).toBeVisible();
    await expect(dialog.getByText('Frame analysis')).toHaveCount(0);
    await expect(dialog.getByText('OCR extraction')).toHaveCount(0);
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
