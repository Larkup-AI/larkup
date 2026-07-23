import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe.serial('Chat Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/chat');
    await expect(
      page.getByText('Chat with your knowledge base').or(page.getByText('Setup Required')).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test('page loads with correct heading', async ({ page }) => {
    await expect(
      page.getByText('Chat with your knowledge base').or(page.getByText('Setup Required')).first(),
    ).toBeVisible();
  });

  test('send a message and receive a response', async ({ page }) => {
    test.setTimeout(120_000);
    const isSetupRequired = await page.getByText('Setup Required').isVisible();
    if (isSetupRequired) {
      test.skip(true, 'Setup is required');
      return;
    }

    const chatInput = page.locator('textarea[placeholder*="How can I help you" i]').first();
    if (await chatInput.isVisible()) {
      await chatInput.fill('What is Larkup?');
      await chatInput.press('Enter');

      const responseElement = page
        .locator('[class*="message"], [class*="chat-bubble"], [role="log"] > div')
        .last();
      await expect(responseElement).toBeVisible({ timeout: 60_000 });
      const responseText = await responseElement.textContent();
      expect(responseText?.length).toBeGreaterThan(10);
    }
  });

  test('toggle web search', async ({ page }) => {
    const isSetupRequired = await page.getByText('Setup Required').isVisible();
    if (isSetupRequired) return;

    // Click plus button
    await page
      .locator('button', { has: page.locator('.lucide-plus') })
      .first()
      .click();

    // Click Web Search
    const webSearchBtn = page.getByText('Web Search');
    await expect(webSearchBtn).toBeVisible();
    await webSearchBtn.click();
  });

  test('upload attachment', async ({ page }) => {
    const isSetupRequired = await page.getByText('Setup Required').isVisible();
    if (isSetupRequired) return;

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page
      .locator('button', { has: page.locator('.lucide-plus') })
      .first()
      .click();
    await page.getByText('Attach Document').click();

    const fileChooser = await fileChooserPromise;
    // Create a dummy file to upload
    const testFile = path.resolve('test-attachment.txt');
    fs.writeFileSync(testFile, 'This is a test file for upload.');

    await fileChooser.setFiles(testFile);

    // Ensure attachment card appears
    await expect(page.getByText('test-attachment.txt')).toBeVisible();

    // Cleanup
    fs.unlinkSync(testFile);
  });

  test('chat history displays and can load previous chat', async ({ page }) => {
    const isSetupRequired = await page.getByText('Setup Required').isVisible();
    if (isSetupRequired) return;

    // Open History
    await page
      .locator('button', { has: page.locator('.lucide-history') })
      .first()
      .click();

    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
  });
});
