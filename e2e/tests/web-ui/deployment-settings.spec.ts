import { test, expect } from '@playwright/test';

test.describe('Deployment Settings UI', () => {
  test('should navigate to deployment settings and configure agent', async ({ page }) => {
    await page.goto('/settings?section=deployment');

    // Check heading
    await expect(page.getByRole('heading', { name: 'Deploy & Share Agent' })).toBeVisible();

    // Verify Agent Type dropdown
    const typeTrigger = page.locator('button[role="combobox"]').first();
    await expect(typeTrigger).toBeVisible();

    // Change deployment type to Full Agent
    await typeTrigger.click();
    await page.getByRole('option', { name: 'Full Agent (Chat UI & Widget)' }).click();

    // System prompt should now be visible
    await expect(page.getByLabel('System Prompt')).toBeVisible();

    // Verify Authentication Mode
    const authTrigger = page.locator('button[role="combobox"]').nth(1);
    await authTrigger.click();
    await page.getByRole('option', { name: 'Join Code (For Users)' }).click();

    // Join code input should appear
    const joinCodeInput = page.getByLabel('Join Code');
    await expect(joinCodeInput).toBeVisible();
    await joinCodeInput.fill('secret-test-code');

    // Verify Widget Customization appears
    await expect(page.getByText('Widget Customization', { exact: true })).toBeVisible();

    // Change Primary Color
    const colorInput = page.getByLabel('Primary Color').last(); // Get the text input
    await colorInput.fill('#ff0000');

    // Start Agent locally
    const startButton = page.getByRole('button', { name: /Start Agent/ });
    await expect(startButton).toBeVisible();

    // We don't actually start it in E2E to avoid hanging port issues,
    // but we verify the UI is fully functional.
  });
});
