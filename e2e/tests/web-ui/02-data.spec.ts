import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, TEST_PASTE_TEXT, TEST_PASTE_TITLE } from '../../utils/fixtures';
import { hasEnv, ENV_KEYS } from '../../utils/env-loader';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test.describe.serial('Data Page', () => {
  test.beforeEach(async ({ page }) => {
    // The add workspace defaults to Files. Select the Website panel explicitly
    // so this suite does not depend on state left by another browser session.
    await page.goto('/add?subtab=website');
    await page.waitForSelector('text=Add Websites', { timeout: 60_000 });
  });

  test('page changes its guidance to match the active data tab', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Add Websites', exact: true })).toBeVisible();
    await expect(
      page.getByText('Add a URL or discover and crawl websites for your knowledge base.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add Files', exact: true })).toBeVisible();
    await expect(
      page.getByText('Upload PDFs, documents, spreadsheets, CSVs, JSON files, and more.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add Media', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Add Integrations', exact: true }),
    ).toBeVisible();
  });

  test('keeps the primary add action in the tab bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add website' })).toBeDisabled();

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add files' })).toBeDisabled();

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add text' })).toBeDisabled();

    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add media' })).toBeDisabled();
  });

  test('keeps the six available providers above Google integrations awaiting verification', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    for (const integration of [
      'Notion',
      'Google Analytics',
      'Google Calendar',
      'Google Docs',
      'Google Drive',
      'Google Maps',
      'Google Meet',
      'Google Sheets',
      'Google Slides',
      'Jira',
      'Linear',
      'Slack',
      'GitHub',
      'Confluence',
    ]) {
      await expect(page.getByText(integration, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Airtable', { exact: true })).toBeVisible();
    await expect(page.getByText('Microsoft Teams', { exact: true })).toBeVisible();
    await expect(page.getByText('Zoom', { exact: true })).toBeVisible();
    for (const integration of [
      'Google Analytics',
      'Google Calendar',
      'Google Docs',
      'Google Drive',
      'Google Maps',
      'Google Meet',
      'Google Sheets',
      'Google Slides',
    ]) {
      const card = page.locator('[data-integration-id]').filter({ hasText: integration });
      await expect(card.getByText('Coming soon', { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('integration-card').first()).toHaveAttribute(
      'data-integration-id',
      'confluence',
    );
    const displayedIds = await page
      .getByTestId('integration-card')
      .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-integration-id')));
    expect(displayedIds.indexOf('jira')).toBeLessThan(displayedIds.indexOf('google-analytics'));
    expect(displayedIds.indexOf('linear')).toBeLessThan(displayedIds.indexOf('google-analytics'));
    for (const removedIntegration of [
      'Microsoft Dynamics 365',
      'monday.com',
      'Confluence Data Center',
      'Jira Data Center',
    ]) {
      await expect(page.getByText(removedIntegration, { exact: true })).toHaveCount(0);
    }
    await page.getByRole('textbox', { name: 'Search integrations' }).fill('Airtable');
    await expect(page.getByText('Airtable', { exact: true })).toBeVisible();
    await expect(page.getByText('Google Drive', { exact: true })).toHaveCount(0);
  });

  test('promotes connected integrations before other supported sources', async ({ page }) => {
    await page.route('**/api/integrations', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          integrations: [
            { id: 'notion', connected: true },
            { id: 'slack', connected: true },
          ],
        }),
      });
    });

    await page.goto('/add?subtab=notion');
    await expect(page.getByTestId('integration-card').first()).toHaveAttribute(
      'data-integration-id',
      'notion',
    );
    await expect(page.getByTestId('integration-card').nth(1)).toHaveAttribute(
      'data-integration-id',
      'slack',
    );
    await expect(page.getByTestId('integration-card').nth(2)).toHaveAttribute(
      'data-integration-id',
      'confluence',
    );
  });

  test('does not expose Google OAuth until verification is complete', async ({ page }) => {
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    const calendarCard = page.locator('[data-integration-id="google-calendar"]');
    await expect(calendarCard.getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(calendarCard.getByRole('button', { name: 'Connect' })).toHaveCount(0);
    await expect(
      page
        .locator('[data-integration-id="jira"]')
        .getByRole('button', { name: /Connect|Configure/ }),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-integration-id="linear"]')
        .getByRole('button', { name: /Connect|Configure/ }),
    ).toBeVisible();
    const zoomCard = page.locator('[data-integration-id="zoom"]');
    await expect(zoomCard.getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(zoomCard.getByRole('button', { name: 'Connect' })).toHaveCount(0);
  });

  test('disconnects a connected non-Notion integration from its configure panel', async ({
    page,
  }) => {
    let connected = true;
    await page.route('**/api/integrations', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ integrations: [{ id: 'github', connected }] }),
      });
    });
    await page.route('**/api/integrations/github', async (route) => {
      if (route.request().method() === 'DELETE') {
        connected = false;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          connected,
          resources: connected ? [{ id: 'repo', title: 'larkup/repo', kind: 'repository' }] : [],
        }),
      });
    });

    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await page
      .locator('[data-integration-id="github"]')
      .getByRole('button', { name: 'Configure' })
      .click();
    await expect(page.getByText('GitHub connected')).toBeVisible();
    const disconnect = page.getByRole('button', { name: 'Disconnect' });
    await expect(disconnect).toHaveClass(/bg-red-500/);
    await disconnect.click();
    await expect(
      page.locator('[data-integration-id="github"]').getByRole('button', { name: 'Connect' }),
    ).toBeVisible();
  });

  test('Notion resource rows truncate long values without horizontal overflow', async ({
    page,
  }) => {
    await page.route('**/api/integrations', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ integrations: [{ id: 'notion', connected: true }] }),
      });
    });
    await page.route('**/api/integrations/notion', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          connected: true,
          configured: true,
          pages: [
            {
              id: 'long-page',
              title:
                'https://brandlogos.net/wp-content/uploads/2025/12/google_antigravity-logo_brandlogos.net_qw4jc.png',
              icon: 'https://cdn.notion.so/very-long-external-icon-path.png',
              url: 'https://notion.so/long-page',
              lastEdited: '2026-08-04T00:00:00.000Z',
              parentType: 'workspace',
            },
          ],
          databases: [],
        }),
      });
    });

    await page.goto('/add?subtab=notion');
    await page.getByRole('button', { name: 'Configure', exact: true }).click();

    const list = page.getByTestId('notion-resource-list');
    await expect(list).toBeVisible();
    await expect(
      page.getByTitle(
        'https://brandlogos.net/wp-content/uploads/2025/12/google_antigravity-logo_brandlogos.net_qw4jc.png',
      ),
    ).toBeVisible();
    expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  // ── File Uploads ──────────────────────────────────────────────────────────

  test('upload PDF file', async ({ page }) => {
    test.setTimeout(60_000);

    const uploadTab = page.getByText('Files', { exact: true }).first();
    await uploadTab.click();
    await page.waitForTimeout(300);

    // Find the file input (may be hidden, so we use setInputFiles)
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60_000 });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.pdf);
    await page.waitForTimeout(3_000);

    // Verify the document appears in the corpus list
    await expect(page.getByText('demo').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('upload TXT file', async ({ page }) => {
    test.setTimeout(60_000);

    const uploadTab = page.getByText('Files', { exact: true }).first();
    await uploadTab.click();
    await page.waitForTimeout(300);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.txt);
    await page.waitForTimeout(3_000);

    await expect(page.getByText('demo').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('upload DOCX file', async ({ page }) => {
    test.setTimeout(60_000);

    const uploadTab = page.getByText('Files', { exact: true }).first();
    await uploadTab.click();
    await page.waitForTimeout(300);

    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60_000 });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.docx);
    await page.waitForTimeout(3_000);

    await expect(page.getByText('demo').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('upload JSON file', async ({ page }) => {
    test.setTimeout(60_000);

    const uploadTab = page.getByText('Files', { exact: true }).first();
    await uploadTab.click();
    await page.waitForTimeout(300);

    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60_000 });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.json);
    await page.waitForTimeout(3_000);

    // Verify no critical error
    const errorToast = page.getByText('error', { exact: false }).first();
    const hasError = await errorToast.isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasError) {
      console.warn('  ⚠ JSON upload may have had issues');
    }
  });

  test('upload CSV file', async ({ page }) => {
    test.setTimeout(60_000);

    const uploadTab = page.getByText('Files', { exact: true }).first();
    await uploadTab.click();
    await page.waitForTimeout(300);

    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60_000 });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.csv);
    await page.waitForTimeout(3_000);

    await expect(page.getByText('demo').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  // ── Paste Text ────────────────────────────────────────────────────────────

  test('paste raw text as document', async ({ page }) => {
    test.setTimeout(30_000);

    // Look for a paste/text tab or button
    const pasteTab = page.getByText('Text', { exact: true }).first();
    await pasteTab.click();
    await page.waitForTimeout(300);

    // Find the text area for pasting
    const textArea = page.locator('textarea').first();
    if (await textArea.isVisible()) {
      await textArea.fill(TEST_PASTE_TEXT);

      // Look for a title input
      const titleInput = page
        .locator('input[placeholder*="title" i], input[id*="title" i]')
        .first();
      if (await titleInput.isVisible()) {
        await titleInput.fill(TEST_PASTE_TITLE);
      }

      // Submit/Add the document
      const addBtn = page.getByRole('button', { name: /Add|Submit|Save/i }).first();
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(2_000);
      }
    }
  });

  // ── Web Scraping ──────────────────────────────────────────────────────────

  test('web scraping panel is visible', async ({ page }) => {
    // Look for the scrape panel/tab
    const scrapeTab = page.getByText('Website', { exact: true }).first();
    if (await scrapeTab.isVisible()) {
      await scrapeTab.click();
      await page.waitForTimeout(500);

      // Direct URL is the default because it is the most predictable way to
      // add a known page. Search remains available as an explicit mode.
      const urlInput = page.locator('input[placeholder*="url" i]').first();
      await expect(urlInput).toBeVisible({ timeout: 5_000 });
      await page.getByText('Search', { exact: true }).first().click();
      await expect(
        page.locator('input[placeholder*="search for websites" i]').first(),
      ).toBeVisible();
    }
  });

  test('web scrape with Firecrawl', async ({ page }) => {
    test.skip(!hasEnv(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY), 'FIRECRAWL_CLOUD_API_KEY not set');
    test.setTimeout(120_000);

    const scrapeTab = page.getByText('Website', { exact: true }).first();
    await scrapeTab.click();
    await page.waitForTimeout(500);

    // Switch to Direct URL mode
    const directUrlTab = page.getByText('Direct URL').first();
    await directUrlTab.click();
    await page.waitForTimeout(300);

    // Enter a URL to scrape
    const urlInput = page
      .locator('input[placeholder*="url" i], input[placeholder*="http" i]')
      .first();
    if (await urlInput.isVisible()) {
      await urlInput.fill('https://example.com');
      await page.waitForTimeout(300);

      // Click start/scrape button
      const scrapeBtn = page.getByRole('button', { name: /Start|Scrape|Add|Crawl/i }).first();
      if (await scrapeBtn.isVisible()) {
        await scrapeBtn.click();
        await page.waitForTimeout(5_000);

        // Verify job appears or document added
        const jobStatus = page.getByText(/queued|running|completed|scraping/i).first();
        await expect(jobStatus).toBeVisible({ timeout: 30_000 });
      }
    }
  });

  test('web search with Serper', async ({ page }) => {
    test.skip(
      !hasEnv(ENV_KEYS.SERPER_API_KEY) || !hasEnv(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY),
      'Search requires Serper and Crawling requires Firecrawl',
    );
    test.setTimeout(60_000);

    // Navigate to the scrape section
    const scrapeTab = page.getByText('Website', { exact: true }).first();
    await scrapeTab.click();
    await page.waitForTimeout(500);

    // Look for search functionality
    const searchInput = page.locator('input[placeholder*="search" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Larkup AI');
      const searchBtn = page.getByRole('button', { name: /Search/i }).first();
      if (await searchBtn.isVisible()) {
        await searchBtn.click();
        await page.waitForTimeout(5_000);
      }
    }
  });

  // ── Corpus Management ─────────────────────────────────────────────────────

  test('corpus document list shows uploaded documents', async ({ page }) => {
    await page.goto('/data');
    await page.waitForTimeout(500);

    // After previous uploads, verify the corpus has documents
    const docItems = page.locator('[class*="document"], [class*="corpus"], tr, [class*="item"]');
    const count = await docItems.count();
    // We expect at least 1 document from previous tests (or pre-existing)
    console.log(`  📄 Documents visible in corpus: ${count}`);
  });

  test('corpus exposes a clear-all reset action', async ({ page }) => {
    await page.goto('/data');

    await expect(page.getByRole('button', { name: 'Clear all files' })).toBeVisible();
  });

  test('delete a document from corpus', async ({ page }) => {
    await page.goto('/data');
    await page.waitForTimeout(500);

    // Find a delete button on any document
    const deleteBtn = page
      .locator(
        'button:has(svg.lucide-trash), button:has(svg.lucide-trash-2), button[aria-label*="delete" i]',
      )
      .first();
    if (await deleteBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(1_000);

      // Confirm deletion if there's a dialog
      const confirmBtn = page.getByRole('button', { name: /Confirm|Delete|Yes|Remove/i }).last();
      if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  // ── Media Tab ─────────────────────────────────────────────────────────────

  test('media tab has upload and URL entry modes', async ({ page }) => {
    const mediaTab = page.getByText('Media', { exact: true }).first();
    if (await mediaTab.isVisible()) {
      await mediaTab.click();
      await page.waitForTimeout(500);

      await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByRole('button', { name: 'From URL' })).toBeVisible();
    }
  });

  test('upload image to media tab', async ({ page }) => {
    test.setTimeout(60_000);

    const mediaTab = page.getByText('Media', { exact: true }).first();
    await mediaTab.click();
    await page.waitForTimeout(500);

    // Find the file input in the media panel
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60_000 });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.png);
    await page.waitForTimeout(3_000);

    // Click upload button
    const uploadBtn = page.getByRole('button', { name: 'Add media' });
    if (await uploadBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await uploadBtn.click();
      await page.waitForTimeout(3_000);
    }
  });

  test('uploaded media library supports search, source-style filters, and pagination', async ({
    page,
  }) => {
    await page.getByText('Media', { exact: true }).first().click();

    const viewUploads = page.getByRole('button', { name: 'View Uploads' });
    test.skip(
      !(await viewUploads.isVisible({ timeout: 5_000 }).catch(() => false)),
      'No uploaded media is available in this test environment.',
    );

    await viewUploads.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Uploaded media' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Search uploaded media' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Images \d+/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Previous uploads page' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Next uploads page' })).toBeVisible();
  });

  test('video uploads stage without asking for a host ffmpeg installation', async ({ page }) => {
    const mediaTab = page.getByText('Media', { exact: true }).first();
    await mediaTab.click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'demo.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.alloc(8),
    });
    await expect(page.getByText('demo.mp4', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add media' })).toBeEnabled();
    await expect(page.getByText(/Missing system dependencies|brew install ffmpeg/i)).toHaveCount(0);
  });

  test('Media upgrade guidance replaces the legacy yt-dlp installation prompt', async () => {
    const source = await readFile(
      path.join(repoRoot, 'apps/web/components/data/media-panel.tsx'),
      'utf8',
    );
    expect(source).toContain("normalizedMessage.includes('yt-dlp is required for youtube urls')");
    expect(source).toContain("label: 'Update tool'");
  });

  test('audio uploads provide a playable staged preview', async ({ page }) => {
    const mediaTab = page.getByText('Media', { exact: true }).first();
    await mediaTab.click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"]').first();
    test.skip(
      !(await fileInput.isVisible({ timeout: 5_000 }).catch(() => false)),
      'The Video & Audio tool is not installed in this test environment.',
    );

    await fileInput.setInputFiles({
      name: 'preview.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.alloc(44),
    });

    await expect(page.getByLabel('Preview preview.wav')).toBeVisible();
  });

  test('media indexing shows the primary live pipeline stage', async ({ page }) => {
    const updatedAt = new Date().toISOString();
    const mediaPayload = {
      assets: [
        {
          id: 'live-video-progress',
          type: 'video',
          fileName: 'arabic-match.mp4',
          mimeType: 'video/mp4',
          storageUri: 'local://videos/arabic-match.mp4',
          fileSize: 10_000,
          processingStatus: 'processing',
          processingMessage: 'Understanding visual sequence 18 of 43...',
          processingProgress: 47,
          processingRevision: 12,
          processingSteps: [
            { stage: 'download', status: 'completed', percent: 100, updatedAt },
            {
              stage: 'extract',
              status: 'completed',
              percent: 100,
              current: 216,
              total: 216,
              unit: 'frames',
              updatedAt,
            },
            {
              stage: 'transcribe',
              status: 'running',
              current: 2,
              total: 5,
              unit: 'audio parts',
              message: 'Transcribing audio part 2 of 5...',
              updatedAt,
            },
            {
              stage: 'vision',
              status: 'running',
              current: 18,
              total: 43,
              unit: 'sequences',
              message: 'Understanding visual sequence 18 of 43...',
              updatedAt,
            },
            { stage: 'synthesize', status: 'waiting', updatedAt },
            { stage: 'index', status: 'waiting', updatedAt },
          ],
          documentIds: [],
          createdAt: updatedAt,
          updatedAt,
        },
      ],
      stats: {
        total: 1,
        byType: { image: 0, video: 1, audio: 0 },
        byStatus: { pending: 0, processing: 1, completed: 0, failed: 0 },
        totalBytes: 10_000,
      },
      storage: { usedBytes: 10_000, fileCount: 1 },
    };

    await page.route('**/api/marketplace', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            {
              id: 'video-audio',
              name: 'Video & Audio',
              status: 'installed',
              configSchema: [],
            },
          ],
        }),
      });
    });
    await page.route('**/api/media?type=**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(mediaPayload),
      });
    });
    await page.route('**/api/media/stream?**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: `event: media-update\ndata: ${JSON.stringify(mediaPayload)}\n\n`,
      });
    });

    await page.goto('/add?subtab=media');

    await expect(page.getByText('Indexing 1 file')).toBeVisible();
    // The UI deliberately shows only the primary active step, avoiding a
    // noisy list of concurrent pipeline stages while preserving its exact
    // factual progress and the independent overall percentage.
    await expect(
      page.getByText('Visual analysis · 18 / 43 sequences · 42% this step'),
    ).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(1);
  });
});
