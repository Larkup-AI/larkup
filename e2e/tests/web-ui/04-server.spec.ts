import { test, expect, type Page } from '@playwright/test';

interface LocalServerState {
  running: boolean;
  port: number;
}

async function readLocalServerState(page: Page): Promise<LocalServerState> {
  const response = await page.request.get('/api/server/local');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { state: LocalServerState };
  return body.state;
}

async function ensureLocalServerState(page: Page, shouldRun: boolean): Promise<LocalServerState> {
  const buttonName = shouldRun ? 'Launch server' : 'Stop server';
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const state = await readLocalServerState(page);
    if (state.running === shouldRun) return state;

    const control = page.getByRole('button', { name: buttonName, exact: true });
    if (
      (await control.isVisible({ timeout: 1_000 }).catch(() => false)) &&
      (await control.isEnabled())
    ) {
      // Status hydration can replace the control between discovery and click.
      // A short retry loop follows the API state instead of holding a stale node.
      await control.click({ timeout: 3_000 }).catch(() => undefined);
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Local server did not become ${shouldRun ? 'running' : 'stopped'} within 60s`);
}

test.describe.serial('Server Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings?section=server');
    await page.waitForSelector('text=Test locally, then deploy', { timeout: 60_000 });
  });

  test('page loads with correct heading', async ({ page }) => {
    // The section was renamed to "Knowledge Server" to match the TASK 01
    // boundary: this page deploys the data plane, not an Agent.
    await expect(
      page.getByRole('heading', { name: 'Knowledge Server', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Test locally, then deploy your Knowledge Server anywhere.'),
    ).toBeVisible();
  });

  test('server generation panel loads', async ({ page }) => {
    await expect(page.getByText('Local Knowledge Server').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('cloud deployments link directly to their API reference', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async () => {
      const res = await fetch('/api/servers');
      const data = await res.json();
      const serverId = data.activeServerId || 'default';

      // The server API key is server-side credential storage now (ADR-004),
      // not localStorage — seed it through the same API the app writes to.
      await fetch('/api/config/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverApiKey: 'sk-cloud-api-key-test' }),
      });
      localStorage.setItem(`larkup_api_key_version_${serverId}`, '1');
      localStorage.setItem(
        `larkup_deployments_${serverId}`,
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

    await page.evaluate(async () => {
      const res = await fetch('/api/servers');
      const data = await res.json();
      const serverId = data.activeServerId || 'default';
      localStorage.removeItem(`larkup_deployments_${serverId}`);
      localStorage.removeItem(`larkup_api_key_version_${serverId}`);
      await fetch('/api/config/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: ['serverApiKey'] }),
      });
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
    await page.getByRole('tab', { name: 'General' }).click();
    await expect(page.getByText('Environment Variables')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deploy' }).last()).toBeVisible();
  });

  test('launch RAG server', async ({ page }) => {
    test.setTimeout(120_000);

    const state = await ensureLocalServerState(page, true);
    const runningIndicator = page.getByText(`running on :${state.port}`, { exact: true });

    await expect(runningIndicator).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect to Server SDK' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Try it (cURL)' })).toBeVisible();
    await expect(page.getByText('API reference', { exact: true })).toHaveAttribute(
      'href',
      `http://localhost:${state.port}/reference`,
    );
  });

  test('stop RAG server', async ({ page }) => {
    test.setTimeout(90_000);

    await ensureLocalServerState(page, false);
    await expect(page.getByRole('button', { name: 'Launch server', exact: true })).toBeVisible();
    await expect(page.getByText('stopped', { exact: true })).toBeVisible();
  });

  test('JS SDK connection test (via curl)', async ({ page }) => {
    test.setTimeout(60_000);

    const state = await ensureLocalServerState(page, true);
    await expect(page.getByText(`running on :${state.port}`, { exact: true })).toBeVisible();

    const fetchUrl = `http://127.0.0.1:${state.port}`;
    let healthOk = false;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch(`${fetchUrl}/health`);
        const data = await response.json();
        healthOk = data.ok === true || response.ok;
      } catch (error) {
        console.error(
          `Fetch error (attempt ${i + 1}):`,
          error instanceof Error ? error.message : error,
        );
      }

      if (healthOk) break;
      await page.waitForTimeout(2_000);
    }

    expect(healthOk).toBe(true);
  });
});
