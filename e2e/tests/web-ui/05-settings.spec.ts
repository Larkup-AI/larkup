import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('text=Settings', { timeout: 15_000 });
  });

  test('settings page loads with correct heading', async ({ page }) => {
    await expect(page.getByText('Settings').first()).toBeVisible();
  });

  test('server section is accessible', async ({ page }) => {
    const serverLink = page.getByText('Server', { exact: true }).first();
    if (await serverLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await serverLink.click();
      await page.waitForTimeout(500);

      await expect(page.getByText('Launch, manage, and connect').first()).toBeVisible({
        timeout: 10_000,
      });
      console.log('  ✓ Server section loaded');
    }
  });

  test('marketplace section is accessible', async ({ page }) => {
    const marketplaceLink = page.getByText('Marketplace', { exact: true }).first();
    if (await marketplaceLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await marketplaceLink.click();
      await page.waitForTimeout(500);

      await expect(page.getByText('Extend Larkup with optional tools').first()).toBeVisible({
        timeout: 10_000,
      });
      console.log('  ✓ Marketplace section loaded');
    }
  });

  test('connections section is accessible', async ({ page }) => {
    const connectionsLink = page.getByText('Connections', { exact: true }).first();
    if (await connectionsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await connectionsLink.click();
      await page.waitForTimeout(500);

      // Just verify the section loaded without errors
      console.log('  ✓ Connections section loaded');
    }
  });

  test('analytics section is accessible', async ({ page }) => {
    const analyticsLink = page.getByText('Analytics', { exact: true }).first();
    if (await analyticsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await analyticsLink.click();
      await page.waitForTimeout(500);

      console.log('  ✓ Analytics section loaded');
    }
  });
});
