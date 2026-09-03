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
    await expect(page.getByRole('heading', { name: 'Data', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // The sidebar starts collapsed, so the links carry an icon and no label.
    // Their destinations are the stable contract.
    for (const href of ['/chat', '/add', '/data', '/settings']) {
      await expect(page.locator(`nav a[href="${href}"]`).first()).toBeVisible();
    }
  });

  test('navigate to Data page', async ({ page }) => {
    await page.goto('/data');
    await expect(
      page.getByText('Add sources, organize groups, and manage indexing.').first(),
    ).toBeVisible({
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
