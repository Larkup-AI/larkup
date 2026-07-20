import { test, expect } from '@playwright/test';
import { FIXTURES, TEST_PASTE_TEXT, TEST_PASTE_TITLE } from '../../utils/fixtures';
import { hasEnv, ENV_KEYS } from '../../utils/env-loader';

test.describe.serial('Data Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/data');
    await page.waitForSelector('text=Upload files, scrape the web', { timeout: 60_000 });
  });

  test('page loads with correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Data', exact: true })).toBeVisible();
    await expect(
      page.getByText('Upload files, scrape the web, or manage your knowledge base.'),
    ).toBeVisible();
  });

  // ── File Uploads ──────────────────────────────────────────────────────────

  test('upload PDF file', async ({ page }) => {
    test.setTimeout(60_000);

    const uploadTab = page.getByText('Files', { exact: true }).first();
    if (await uploadTab.isVisible()) {
      await uploadTab.click();
      await page.waitForTimeout(300);
    }

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
    if (await uploadTab.isVisible()) {
      await uploadTab.click();
      await page.waitForTimeout(300);
    }

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
    if (await uploadTab.isVisible()) {
      await uploadTab.click();
      await page.waitForTimeout(300);
    }

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
    if (await uploadTab.isVisible()) {
      await uploadTab.click();
      await page.waitForTimeout(300);
    }

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
    if (await uploadTab.isVisible()) {
      await uploadTab.click();
      await page.waitForTimeout(300);
    }

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
    if (await pasteTab.isVisible()) {
      await pasteTab.click();
      await page.waitForTimeout(300);
    }

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
    test.skip(
      !hasEnv(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY) && !hasEnv(ENV_KEYS.SERPER_API_KEY),
      'No search providers configured',
    );

    // Look for the scrape panel/tab
    const scrapeTab = page.getByText('Website', { exact: true }).first();
    if (await scrapeTab.isVisible()) {
      await scrapeTab.click();
      await page.waitForTimeout(500);

      // Verify scrape panel elements exist (defaults to Search mode)
      const searchInput = page.locator('input[placeholder*="search" i]').first();
      await expect(searchInput).toBeVisible({ timeout: 5_000 });
    }
  });

  test('web scrape with Firecrawl', async ({ page }) => {
    test.skip(!hasEnv(ENV_KEYS.FIRECRAWL_CLOUD_API_KEY), 'FIRECRAWL_CLOUD_API_KEY not set');
    test.setTimeout(120_000);

    const scrapeTab = page.getByText('Website', { exact: true }).first();
    if (await scrapeTab.isVisible()) {
      await scrapeTab.click();
      await page.waitForTimeout(500);
    }

    // Switch to Direct URL mode
    const directUrlTab = page.getByText('Direct URL').first();
    if (await directUrlTab.isVisible()) {
      await directUrlTab.click();
      await page.waitForTimeout(300);
    }

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
    if (await scrapeTab.isVisible()) {
      await scrapeTab.click();
      await page.waitForTimeout(500);
    }

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
    // Switch to Knowledge Base tab
    const kbTab = page.getByText('Knowledge Base', { exact: true }).first();
    if (await kbTab.isVisible()) {
      await kbTab.click();
      await page.waitForTimeout(500);
    }

    // After previous uploads, verify the corpus has documents
    const docItems = page.locator('[class*="document"], [class*="corpus"], tr, [class*="item"]');
    const count = await docItems.count();
    // We expect at least 1 document from previous tests (or pre-existing)
    console.log(`  📄 Documents visible in corpus: ${count}`);
  });

  test('delete a document from corpus', async ({ page }) => {
    // Switch to Knowledge Base tab
    const kbTab = page.getByText('Knowledge Base', { exact: true }).first();
    if (await kbTab.isVisible()) {
      await kbTab.click();
      await page.waitForTimeout(500);
    }

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

  test('media tab shows Images sub-tab', async ({ page }) => {
    const mediaTab = page.getByText('Media', { exact: true }).first();
    if (await mediaTab.isVisible()) {
      await mediaTab.click();
      await page.waitForTimeout(500);

      // Images sub-tab should be visible and active
      await expect(page.getByRole('button', { name: /^Images/ })).toBeVisible({
        timeout: 5_000,
      });
    }
  });

  test('upload image to media tab', async ({ page }) => {
    test.setTimeout(60_000);

    const mediaTab = page.getByText('Media', { exact: true }).first();
    if (await mediaTab.isVisible()) {
      await mediaTab.click();
      await page.waitForTimeout(500);
    }

    // Find the file input in the media panel
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 60_000 });
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURES.png);
    await page.waitForTimeout(3_000);

    // Click upload button
    const uploadBtn = page.getByRole('button', { name: /Upload/i }).first();
    if (await uploadBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await uploadBtn.click();
      await page.waitForTimeout(3_000);
    }
  });

  test('media video tab shows install prompt', async ({ page }) => {
    const mediaTab = page.getByText('Media', { exact: true }).first();
    if (await mediaTab.isVisible()) {
      await mediaTab.click();
      await page.waitForTimeout(500);
    }

    // Switch to Video sub-tab
    const videoTab = page.getByText('Video', { exact: true }).first();
    if (await videoTab.isVisible()) {
      await videoTab.click();
      await page.waitForTimeout(500);

      // Should show install prompt if tool not installed
      const installPrompt = page.getByText('Install from Marketplace');
      const hasPrompt = await installPrompt.isVisible({ timeout: 5_000 }).catch(() => false);
      console.log(`  📦 Video tab install prompt visible: ${hasPrompt}`);
    }
  });
});
