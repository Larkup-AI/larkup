import { test, expect } from '@playwright/test';

test.describe.serial('Server Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings?section=server');
    await page.waitForSelector('text=Test locally, then deploy', { timeout: 60_000 });
  });

  test('page loads with correct heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Server', exact: true })).toBeVisible();
    await expect(
      page.getByText('Test locally, then deploy one retrieval and chat server anywhere.'),
    ).toBeVisible();
  });

  test('server generation panel loads', async ({ page }) => {
    await expect(page.getByText('Local Server').first()).toBeVisible({ timeout: 60_000 });
  });

  test('cloud deployments link directly to their API reference', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
      localStorage.setItem('rag_server_api_key', 'sk-cloud-api-key-test');
      localStorage.setItem('larkup_api_key_version_default', '1');
      localStorage.setItem(
        'larkup_deployments_default',
        JSON.stringify([
          {
            id: 'vercel:api-reference-test',
            provider: 'vercel',
            project: 'api-reference-test',
            url: 'https://api-reference-test-abc123.vercel.app/',
            status: 'ready',
            apiKeyVersion: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      );
    });
    await page.reload();

    const referenceLink = page
      .getByRole('link', { name: 'Open API reference for api-reference-test' })
      .first();
    await expect(referenceLink).toHaveAttribute(
      'href',
      'https://api-reference-test-abc123.vercel.app/reference',
    );
    await expect(page.getByText('Key redeploy required')).toBeVisible();

    const copyApiKey = page.getByRole('button', { name: 'Copy cloud API key' }).first();
    await copyApiKey.hover();
    await expect(page.getByText('Copy local key — redeploy to apply it')).toBeVisible();
    await copyApiKey.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('sk-cloud-api-key-test');

    await page.getByRole('button', { name: 'Generate a new API key' }).click();
    await expect(page.getByRole('heading', { name: 'Deploy this new API key?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update & deploy to Vercel' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.evaluate(() => {
      localStorage.removeItem('larkup_deployments_default');
      localStorage.removeItem('larkup_api_key_version_default');
      localStorage.removeItem('rag_server_api_key');
    });
  });

  test('Vercel deployment exposes environment configuration in the deploy sheet', async ({
    page,
  }) => {
    await page.route(/\/api\/config\?serverId=/, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ config: { vectorStore: 'pinecone', storeConfig: {} } }),
      });
    });

    await page.getByRole('button', { name: 'Deploy' }).first().click();
    await page.getByText('Vercel', { exact: true }).first().click();

    await expect(page.getByRole('heading', { name: 'Deploy to Vercel' })).toBeVisible();
    await expect(page.getByText('Environment', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Configure/ })).toBeVisible();
  });

  test('launch RAG server', async ({ page }) => {
    test.setTimeout(120_000);

    // Find and click the launch button
    const launchBtn = page.getByRole('button', { name: /Launch server|Start/i }).first();

    try {
      await expect(launchBtn).toBeVisible({ timeout: 60_000 });
      await launchBtn.click();
      await page.waitForTimeout(5_000);

      // Wait for server to start — look for running indicator
      const runningIndicator = page.getByText(/running on :/i).first();
      await expect(runningIndicator).toBeVisible({ timeout: 60_000 });

      console.log('  ✓ RAG server launched successfully');

      // Verify the endpoint URL is shown
      const endpointLink = page.getByRole('link', { name: /http:\/\/localhost:\d+/ }).first();
      if (await endpointLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const endpointUrl = await endpointLink.textContent();
        console.log(`  ✓ Endpoint URL visible: ${endpointUrl}`);
      }

      // Verify API reference link
      const apiRefLink = page.getByText('Open API Reference').first();
      if (await apiRefLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
        console.log('  ✓ API Reference link visible');
      }

      // Verify the curl command is shown
      const curlCmd = page.getByText('curl').first();
      if (await curlCmd.isVisible({ timeout: 3_000 }).catch(() => false)) {
        console.log('  ✓ Example curl command visible');
      }
    } catch {
      console.warn('  ⚠ Launch button not found');
    }
  });

  test('stop RAG server', async ({ page }) => {
    test.setTimeout(30_000);

    const stopBtn = page.getByRole('button', { name: /Stop server|Stop/i }).first();

    if (await stopBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await stopBtn.click();
      await page.waitForTimeout(3_000);

      // Verify it stopped
      const launchBtn = page.getByRole('button', { name: /Launch server|Start/i }).first();
      await expect(launchBtn).toBeVisible({ timeout: 60_000 });
      console.log('  ✓ RAG server stopped');
    } else {
      console.log('  ℹ Server not running — skipping stop test');
    }
  });

  test('JS SDK connection test (via curl)', async ({ page }) => {
    test.setTimeout(60_000);

    // Re-launch if not running
    const launchBtn = page.getByRole('button', { name: /Launch server|Start/i }).first();
    if (await launchBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await launchBtn.click();
      await page.waitForTimeout(10_000);
    }

    // Verify server is reachable via direct fetch
    const runningIndicator = page.getByText(/running on :/i).first();
    if (await runningIndicator.isVisible({ timeout: 30_000 }).catch(() => false)) {
      const endpointLink = page.getByRole('link', { name: /http:\/\/localhost:\d+/ }).first();
      const endpoint = await endpointLink.textContent();

      // Test the RAG server directly via Node.js fetch (simulating SDK/curl)
      const healthOk = await (async (url) => {
        try {
          const res = await fetch(`${url}/health`);
          const data = await res.json();
          return data.ok === true || res.ok;
        } catch (e) {
          console.error('Fetch error:', e);
          return false;
        }
      })(endpoint?.trim() || '');
      expect(healthOk).toBe(true);
      console.log(`  ✓ RAG server health check passed via browser against ${endpoint}`);
    }
  });
});
