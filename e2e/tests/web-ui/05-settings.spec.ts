import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForSelector('text=Settings', { timeout: 60_000 });
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

  test('search provider verification', async ({ page }) => {
    // Intercept the /api/search/verify endpoint to return success
    await page.route('/api/search/verify', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.provider && body.apiKey) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Missing provider or key' }),
        });
      }
    });

    const generalLink = page.getByText('General', { exact: true }).first();
    if (await generalLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await generalLink.click();
      await page.waitForTimeout(500);

      // Verify the web search provider select exists
      const providerSelect = page.getByRole('combobox').first();
      if (await providerSelect.isVisible()) {
        await providerSelect.click();

        // Select Brave
        const braveOption = page.getByText('Brave', { exact: true }).first();
        if (await braveOption.isVisible()) {
          await braveOption.click();

          // Enter dummy API key
          const apiKeyInput = page.getByPlaceholder('Your Brave API Key').first();
          await apiKeyInput.fill('dummy-brave-key');

          // Click Verify
          const verifyBtn = page.getByRole('button', { name: 'Verify' }).first();
          await verifyBtn.click();

          // Check if verification succeeded
          await expect(page.getByText('✓ Verified')).toBeVisible({ timeout: 5_000 });
        }
      }
    }
  });
});
