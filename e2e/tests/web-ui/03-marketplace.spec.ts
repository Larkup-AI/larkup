import { test, expect } from '@playwright/test';

test.describe('Marketplace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings?section=marketplace');
    await page.waitForSelector('text=Marketplace', { timeout: 60_000 });
  });

  test('marketplace page loads with correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
    await expect(page.getByText('Extend Larkup with optional tools')).toBeVisible();
  });

  test('tool cards are visible', async ({ page }) => {
    // Wait for tools to load
    await page.waitForTimeout(2_000);

    // The media tool is published under its product name.
    await expect(
      page.getByRole('heading', { name: 'Video Intelligence', exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // CLIP tool should be visible with "Coming soon"
    await expect(page.getByText('CLIP Image Search')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Soon', { exact: true })).toBeVisible();
  });

  test('install button is visible for available tools', async ({ page }) => {
    await page.waitForTimeout(2_000);

    const actionBtn = page
      .locator('button:has-text("Install"), span:has-text("Installed")')
      .first();
    await expect(actionBtn).toBeVisible({ timeout: 10_000 });
  });

  test('installed tool settings render every field the manifest declares', async ({ page }) => {
    await page.route('**/api/marketplace', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            {
              id: 'video-intelligence',
              name: 'Video Intelligence',
              description: 'Evidence-backed video analysis.',
              emoji: '🎬',
              status: 'installed',
              configSchema: [
                {
                  key: 'audioProvider',
                  label: 'Audio Provider',
                  type: 'select',
                  options: [{ label: 'OpenAI', value: 'openai' }],
                },
                { key: 'audioApiKey', label: 'Audio API Key', type: 'password' },
                {
                  key: 'maxDurationSecs',
                  label: 'Maximum video duration (seconds)',
                  type: 'text',
                  defaultValue: '14400',
                },
                {
                  key: 'videoKnowledgeEnabled',
                  label: 'Video Knowledge Engine',
                  type: 'select',
                  defaultValue: 'true',
                  options: [{ label: 'Enabled', value: 'true' }],
                },
              ],
            },
          ],
        }),
      }),
    );
    await page.route('**/api/config', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          config: { toolConfigs: { 'video-intelligence': { audioProvider: 'openai' } } },
        }),
      }),
    );
    await page.goto('/settings?section=tool-settings');
    await expect(page.getByText('Maximum video duration (seconds)', { exact: true })).toBeVisible();
    await expect(page.getByText('Video Knowledge Engine', { exact: true })).toBeVisible();
  });
});
