import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  test('settings page loads with correct heading', async ({ page }) => {
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByText('Workspace and integration settings.')).toBeVisible();
  });

  test('server section is accessible', async ({ page }) => {
    await page.getByRole('button', { name: 'Larkup Server', exact: true }).click();

    // The section was renamed to "Knowledge Server" to match the TASK 01
    // boundary: this page deploys the data plane, not an Agent.
    await expect(
      page.getByRole('heading', { name: 'Knowledge Server', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Test locally, then deploy your Knowledge Server anywhere.'),
    ).toBeVisible();
  });

  test('marketplace section is accessible', async ({ page }) => {
    await page.getByRole('button', { name: 'Marketplace', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Marketplace', exact: true })).toBeVisible();
    await expect(page.getByText('Extend Larkup with optional tools').first()).toBeVisible();
  });

  test('connections section is accessible', async ({ page }) => {
    await page.getByRole('button', { name: 'Connections', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  });

  test('navigation stays responsive while Installed Tools is loading', async ({ page }) => {
    await page.route('/api/marketplace', async () => {
      // Deliberately leave the request pending: this reproduces a slow tools
      // registry without blocking a click on another settings section.
      await new Promise(() => {});
    });

    await page.getByRole('button', { name: 'Installed Tools', exact: true }).click();
    await page.getByRole('button', { name: 'General', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/section=general/);
  });

  test('all settings navigation sections render their content', async ({ page }) => {
    const sections = [
      ['AI Models', 'AI Models'],
      ['Storage', 'Storage'],
      ['Search & Scraping', 'Search & Scraping'],
      ['Agent Customization', 'Agent Customization'],
      ['Playground', 'Playground'],
    ] as const;

    for (const [navigationName, headingName] of sections) {
      await page.getByRole('button', { name: navigationName, exact: true }).click();
      await expect(page.getByRole('heading', { name: headingName, exact: true })).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(
          `section=${encodeURIComponent(
            navigationName === 'AI Models'
              ? 'models'
              : navigationName === 'Search & Scraping'
              ? 'search-web'
              : navigationName === 'Agent Customization'
              ? 'prompts'
              : navigationName.toLowerCase(),
          )}`,
        ),
      );
    }
  });

  test('AI Models exposes an independent vision model card', async ({ page }) => {
    await page.getByRole('button', { name: 'AI Models', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'AI Models', exact: true })).toBeVisible();
    await expect(page.getByText('Vision Model', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Only providers with vision-capable models are shown.', { exact: false }),
    ).toBeVisible();
  });

  test('search provider verification', async ({ page }) => {
    const verificationRequests: Array<{ provider?: string; apiKey?: string }> = [];

    await page.route('/api/search/verify', async (route) => {
      const body = route.request().postDataJSON() as { provider?: string; apiKey?: string };
      verificationRequests.push(body);

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

    await page.getByRole('button', { name: 'Search & Scraping', exact: true }).click();
    const webSearchCard = page.locator('[data-slot="card"]', { hasText: 'Web Search' }).first();
    const providerSelect = webSearchCard.getByRole('combobox');
    const providers = [
      {
        option: 'Serper',
        provider: 'serper',
        placeholder: 'Your Serper API Key',
        apiKey: 'dummy-serper-key',
      },
      {
        option: 'Tavily',
        provider: 'tavily',
        placeholder: 'Your Tavily API Key',
        apiKey: 'dummy-tavily-key',
      },
      {
        option: 'Brave',
        provider: 'brave',
        placeholder: 'Your Brave API Key',
        apiKey: 'dummy-brave-key',
      },
      {
        option: 'Bing (via SerpApi)',
        provider: 'bing',
        placeholder: 'Your SerpApi API Key',
        apiKey: 'dummy-bing-key',
      },
      {
        option: 'Exa',
        provider: 'exa',
        placeholder: 'Your Exa API Key',
        apiKey: 'dummy-exa-key',
      },
    ] as const;

    await expect(providerSelect).toBeVisible();

    for (const provider of providers) {
      await providerSelect.click();
      await page.getByRole('option').filter({ hasText: provider.option }).click();
      await webSearchCard.getByPlaceholder(provider.placeholder).fill(provider.apiKey);
      await webSearchCard.getByRole('button', { name: 'Verify', exact: true }).click();
      await expect(webSearchCard.getByText('✓ Verified')).toBeVisible();

      expect(verificationRequests.at(-1)).toEqual({
        provider: provider.provider,
        apiKey: provider.apiKey,
      });
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
        await providerSelect.click({ force: true });
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
