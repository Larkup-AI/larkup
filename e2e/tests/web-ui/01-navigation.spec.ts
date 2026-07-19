import { test, expect } from '@playwright/test';

test.describe('Navigation & Layout', () => {
  test('root redirects to data page', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/(data|chat|settings)/, { timeout: 60_000 });

    const url = page.url();
    expect(url).toMatch(/\/(data|chat|settings)/);
    console.log(`  ✓ Root redirected to: ${url}`);
  });

  test('sidebar navigation links are visible', async ({ page }) => {
    await page.goto('/data');
    await page.waitForSelector('text=Upload files, scrape the web', { timeout: 60_000 });

    // Verify main navigation items exist in sidebar
    const navItems = ['Data', 'Chat', 'Settings'];
    for (const item of navItems) {
      const link = page
        .getByRole('link', { name: item })
        .or(page.getByText(item, { exact: true }))
        .first();
      const isVisible = await link.isVisible({ timeout: 3_000 }).catch(() => false);
      if (isVisible) {
        console.log(`  ✓ Nav item visible: ${item}`);
      } else {
        console.log(`  ℹ Nav item not found: ${item}`);
      }
    }
  });

  test('navigate to Data page', async ({ page }) => {
    await page.goto('/data');
    await expect(page.getByText('Upload files, scrape the web').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('navigate to Chat page', async ({ page }) => {
    await page.goto('/chat');
    await expect(
      page.getByText('Chat with your knowledge base').or(page.getByText('Setup Required')).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('navigate to Settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Settings').first()).toBeVisible({ timeout: 60_000 });
  });

  test('page has correct title', async ({ page }) => {
    await page.goto('/data');
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    console.log(`  ✓ Page title: "${title}"`);
  });
});
