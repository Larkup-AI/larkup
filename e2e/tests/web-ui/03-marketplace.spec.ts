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

    // Video & Audio tool should be visible
    await expect(page.getByText('Video & Audio')).toBeVisible({ timeout: 10_000 });

    // CLIP tool should be visible with "Coming soon"
    await expect(page.getByText('CLIP Image Search')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Soon', { exact: true })).toBeVisible();
  });

  test('tools show Free badge', async ({ page }) => {
    await page.waitForTimeout(2_000);

    // All current tools should show "Free" badge
    const freeBadges = page.getByText('Free', { exact: true });
    const count = await freeBadges.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('install button is visible for available tools', async ({ page }) => {
    await page.waitForTimeout(2_000);

    const installBtn = page.getByRole('button', { name: /Install/i }).first();
    await expect(installBtn).toBeVisible({ timeout: 10_000 });
  });
});
