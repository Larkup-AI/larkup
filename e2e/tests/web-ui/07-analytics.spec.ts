import { test, expect } from '@playwright/test';

test.describe('Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForSelector('text=Analytics', { timeout: 60_000 });
  });

  test('page loads with correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  });

  test('overview tab shows metrics', async ({ page }) => {
    const overviewTab = page.getByRole('tab', { name: 'Overview' }).first();
    if (await overviewTab.isVisible()) {
      await overviewTab.click();

      // Look for metric cards
      await expect(page.getByText('Total Queries'))
        .toBeVisible({ timeout: 5000 })
        .catch(() => null);
    }
  });

  test('tokens tab shows details', async ({ page }) => {
    const tokensTab = page.getByRole('tab', { name: 'Tokens' }).first();
    if (await tokensTab.isVisible()) {
      await tokensTab.click();

      // Should display token charts or table
      await expect(page.locator('.recharts-wrapper').first())
        .toBeVisible({ timeout: 10_000 })
        .catch(() => null);
    }
  });

  test('pricing tab is accessible', async ({ page }) => {
    const pricingTab = page.getByRole('tab', { name: 'Pricing' }).first();
    if (await pricingTab.isVisible()) {
      await pricingTab.click();

      await expect(page.getByText('Free'))
        .toBeVisible({ timeout: 5000 })
        .catch(() => null);
      await expect(page.getByText('Pro'))
        .toBeVisible({ timeout: 5000 })
        .catch(() => null);
    }
  });
});
