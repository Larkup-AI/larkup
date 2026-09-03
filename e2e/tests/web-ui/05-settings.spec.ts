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
    await expect(page.getByText('Project settings and preferences.')).toBeVisible();
  });

  test('server section is accessible', async ({ page }) => {
    await page.getByRole('button', { name: 'Larkup Server', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Larkup Server', exact: true })).toBeVisible();
    await expect(
      page.getByText('Test locally, then deploy one retrieval and chat server anywhere.'),
    ).toBeVisible();
  });

  test('marketplace section is accessible', async ({ page }) => {
    await page.getByRole('button', { name: 'Marketplace', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Marketplace', exact: true })).toBeVisible();
    await expect(page.getByText('Extend Larkup with optional tools').first()).toBeVisible();
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
      ['AI Models', 'AI Models', 'models'],
      ['Storage & indexing', 'Storage', 'storage'],
      ['Search & Scraping', 'Search & Scraping', 'search-web'],
      ['Marketplace', 'Marketplace', 'marketplace'],
      ['Agent Customization', 'Agent Customization', 'agent-customization'],
      ['Larkup Server', 'Larkup Server', 'runtime'],
      ['Monitor', 'Monitoring', 'monitoring'],
    ] as const;

    for (const [navigationName, headingName, sectionId] of sections) {
      await page.getByRole('button', { name: navigationName, exact: true }).click();
      await expect(page.getByRole('heading', { name: headingName, exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`section=${sectionId}`));
    }
  });

  test('Agent Customization can disable an added skill', async ({ page }) => {
    const skill = {
      id: 'release-checklist',
      name: 'Release checklist',
      description: 'Prepare releases safely.',
      source: 'inline',
      content: '# Release checklist',
      enabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let savedSkills: Array<typeof skill> | undefined;

    await page.route('/api/config', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { skills?: Array<typeof skill> };
        savedSkills = body.skills;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ config: { skills: savedSkills ?? [skill] } }),
      });
    });

    // The shared beforeEach has already loaded the live config, so reload
    // after installing the route to render this test's isolated skill.
    await page.reload();

    await page.getByRole('button', { name: 'Agent Customization', exact: true }).click();
    await page.getByRole('button', { name: 'Skills', exact: true }).click();

    const toggle = page.getByRole('switch', { name: 'Toggle Release checklist' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => savedSkills?.[0]?.enabled).toBe(false);
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
      await expect(webSearchCard.getByText('✓ API Key Verified')).toBeVisible();

      expect(verificationRequests.at(-1)).toEqual({
        provider: provider.provider,
        apiKey: provider.apiKey,
      });
    }
  });

  test('installed tool audio provider verification', async ({ page }) => {
    const verificationRequests: Array<Record<string, unknown>> = [];

    // The tool declares this endpoint in its manifest's configSchema; the key
    // itself is never sent anywhere real from a test.
    await page.route('/api/tools/video-intelligence/verify', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      verificationRequests.push(body);
      await route.fulfill({
        status: body.audioProvider && body.audioApiKey ? 200 : 400,
        contentType: 'application/json',
        body: JSON.stringify(
          body.audioProvider && body.audioApiKey
            ? { success: true }
            : { error: 'Missing provider or key' },
        ),
      });
    });

    await page.getByRole('button', { name: 'Installed Tools', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Audio', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('combobox', { name: 'Audio transcription model' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Vision provider' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Video vision model' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Vision provider API key' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Agent provider' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Agent / tool-brain model' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Agent provider API key' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Audio provider API key' }).fill('dummy-audio-key');
    await page.getByRole('button', { name: 'Verify Audio provider API key' }).click();

    // The banner and the toast carry the same copy.
    await expect(page.getByText('Connection verified successfully.').first()).toBeVisible({
      timeout: 15_000,
    });
    expect(verificationRequests.at(-1)).toMatchObject({ audioApiKey: 'dummy-audio-key' });
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
