import { expect, test } from '@playwright/test';

test.describe('Update banner', () => {
  test('shows the CLI update command and copies it', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('https://www.larkup.de/api/version', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: '999.0.0' }),
      });
    });

    await page.goto('/data');

    await expect(page.getByText('Larkup v999.0.0 is available.')).toBeVisible();

    const copyButton = page.getByRole('button', { name: 'Copy update command' });
    await copyButton.click();

    await expect(copyButton).toContainText('Copied');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('larkup update');
  });
});
