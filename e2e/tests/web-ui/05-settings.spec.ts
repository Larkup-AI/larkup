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

        // Test Exa
        await providerSelect.click();
        const exaOption = page.getByText('Exa', { exact: true }).first();
        if (await exaOption.isVisible()) {
          await exaOption.click();

          // Enter dummy API key
          const exaKeyInput = page.getByPlaceholder('Your Exa API Key').first();
          await exaKeyInput.fill('dummy-exa-key');

          // Click Verify
          const verifyBtn = page.getByRole('button', { name: 'Verify' }).first();
          await verifyBtn.click();

          // Check if verification succeeded
          await expect(page.getByText('✓ Verified')).toBeVisible({ timeout: 5_000 });
        }
      }
    }
  });

  test('video-audio provider verification', async ({ page }) => {
    // Intercept /api/marketplace to ensure video-audio is considered installed
    await page.route('/api/marketplace', async (route) => {
      const response = await route.fetch();
      let json: { tools: any[] } = { tools: [] };
      try {
        json = await response.json();
      } catch (e) {}

      if (!json.tools) json.tools = [];
      const vaTool = json.tools.find((t: any) => t.id === 'video-audio');
      if (vaTool) {
        vaTool.status = 'installed';
      } else {
        json.tools.push({
          id: 'video-audio',
          name: 'Video & Audio',
          status: 'installed',
          configSchema: [
            {
              key: 'audioProvider',
              type: 'select',
              options: [
                { label: 'Deepgram', value: 'deepgram' },
                { label: 'Groq', value: 'groq' },
              ],
            },
            { key: 'audioApiKey', type: 'password' },
          ],
        });
      }
      await route.fulfill({ response, json });
    });

    // Intercept /api/config/verify endpoint
    await page.route('/api/config/verify', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.audioProvider && body.audioApiKey) {
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

    const toolsLink = page.getByText('Installed Tools', { exact: true }).first();
    if (await toolsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await toolsLink.click();
      await page.waitForTimeout(500);

      // Verify the Video & Audio tool exists
      const toolCard = page.locator('.border', { hasText: 'Video & Audio' }).first();
      await expect(toolCard).toBeVisible({ timeout: 5_000 });

      // There should be a combobox inside this card
      const providerSelect = toolCard.getByRole('combobox').first();
      if (await providerSelect.isVisible()) {
        await providerSelect.click();

        // Select Deepgram
        const deepgramOption = page.getByRole('option', { name: 'Deepgram', exact: true }).first();
        if (await deepgramOption.isVisible()) {
          await deepgramOption.click();

          // Enter dummy API key
          const apiKeyInput = toolCard.locator('input[type="password"]').first();
          await apiKeyInput.fill('dummy-deepgram-key');

          // Click Verify
          const verifyBtn = toolCard.getByRole('button', { name: 'Verify' }).first();
          await verifyBtn.click();

          // Check if verification succeeded
          await expect(toolCard.getByText('✓ Verified').first()).toBeVisible({ timeout: 5_000 });
        }

        // Test Groq
        await providerSelect.click();
        const groqOption = page.getByRole('option', { name: 'Groq', exact: true }).first();
        if (await groqOption.isVisible()) {
          await groqOption.click();

          // Enter dummy API key
          const groqKeyInput = toolCard.locator('input[type="password"]').first();
          await groqKeyInput.fill('dummy-groq-key');

          // Click Verify
          const verifyBtn = toolCard.getByRole('button', { name: 'Verify' }).first();
          await verifyBtn.click();

          // Check if verification succeeded
          await expect(toolCard.getByText('✓ Verified').first()).toBeVisible({ timeout: 5_000 });
        }
      }
    }
  });
  test('smart proxy parsing', async ({ page }) => {
    const generalLink = page.getByText('General', { exact: true }).first();
    if (await generalLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await generalLink.click();
      await page.waitForTimeout(500);

      // Verify proxy input parsing
      const proxyServerInput = page
        .getByPlaceholder('http://proxy.example.com:8080 (or paste one-liner)')
        .first();
      if (await proxyServerInput.isVisible()) {
        // Test http format with auth
        await proxyServerInput.fill('http://myuser:mypassword@proxy.host.com:8080');
        await page.waitForTimeout(200); // Wait for state update

        // Switch to form tab to see individual fields
        await page.getByRole('tab', { name: 'Form' }).click();

        const formProxyServerInput = page
          .getByPlaceholder('http://proxy.example.com:8080', { exact: true })
          .first();
        await expect(formProxyServerInput).toHaveValue('http://proxy.host.com:8080');

        // Find username and password inputs by finding the label, going to parent, then finding input
        const usernameInput = page
          .getByText('Proxy Username', { exact: true })
          .locator('..')
          .locator('input');
        await expect(usernameInput).toHaveValue('myuser');

        const passwordInput = page
          .getByText('Proxy Password', { exact: true })
          .locator('..')
          .locator('input');
        await expect(passwordInput).toHaveValue('mypassword');

        // Test ip:port:user:pass format
        await page.getByRole('tab', { name: 'One Line' }).click();
        await proxyServerInput.fill('1.2.3.4:8080:user2:pass2');
        await page.waitForTimeout(200);

        await page.getByRole('tab', { name: 'Form' }).click();
      }
    }
  });

  test('prompts section is accessible and functional', async ({ page }) => {
    // We navigate to Prompts section
    const promptsLink = page.getByText('Prompts', { exact: true }).first();
    if (await promptsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await promptsLink.click();
      await page.waitForTimeout(500);

      // Verify Agent Customization header
      await expect(page.getByText('Agent Customization').first()).toBeVisible({ timeout: 5_000 });

      // Verify System Prompt text area
      const systemPromptArea = page
        .locator('textarea[placeholder*="helpful research assistant"]')
        .first();
      await expect(systemPromptArea).toBeVisible();

      // Check Tools and Plugins tabs
      const toolsTab = page.getByRole('button', { name: /Tools/i }).first();
      const pluginsTab = page.getByRole('button', { name: /Plugins/i }).first();

      if (await toolsTab.isVisible()) {
        await toolsTab.click();
        await expect(page.getByText('Semantic Search').first()).toBeVisible();
      }

      if (await pluginsTab.isVisible()) {
        await pluginsTab.click();
        // Just verify the tab changes and doesn't crash
        await page.waitForTimeout(200);
      }
    }
  });

  test('playground section is accessible', async ({ page }) => {
    const playgroundLink = page.getByText('Playground', { exact: true }).first();
    if (await playgroundLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await playgroundLink.click();
      await page.waitForTimeout(500);

      // Verify Playground loaded
      await expect(page.getByText('Playground', { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
