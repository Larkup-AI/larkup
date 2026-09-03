import { test, expect } from '@playwright/test';

test.describe('Project runtime', () => {
  test.describe.configure({ mode: 'serial' });

  test('shows connection state only on the provider that is connected', async ({ page }) => {
    let slackConnected = true;
    let tunnelStarted = false;
    let managedCheckPayload: { managed?: boolean } | undefined;
    await page.route('**/api/config', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        body: JSON.stringify({ config: { ...data.config, runtimeProfile: 'assistant' } }),
      });
    });
    await page.route('**/api/projects/runtime', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ runtime: { endpoint: 'http://localhost:8080' } }),
      });
    });
    await page.route('**/api/projects/deployments', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ deployments: [] }),
      });
    });
    await page.route('**/api/connections/tunnel', async (route) => {
      if (route.request().method() === 'POST') {
        tunnelStarted = route.request().postDataJSON().action === 'start';
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          tunnelStarted
            ? {
                status: 'running',
                publicUrl: 'https://project.ngrok.app',
                detail: 'Public HTTPS tunnel is running.',
              }
            : {
                status: 'stopped',
                detail: 'Start a public HTTPS tunnel to receive channel webhooks.',
              },
        ),
      });
    });
    await page.route(/\/api\/connections\/slack(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      slackConnected = false;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true }),
      });
    });
    await page.route(/\/api\/connections(?:\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        managedCheckPayload = route.request().postDataJSON() as { managed?: boolean };
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            channel: { status: 'ok', detail: 'Slack is ready.' },
            runtime: { ok: true, name: 'Local runtime' },
          }),
        });
        return;
      }
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          connectionsCatalog: [
            {
              id: 'slack',
              name: 'Slack',
              description: 'Answer Slack messages.',
              icon: '/icons/slack.png',
              configFields: [
                {
                  key: 'botToken',
                  label: 'Bot User OAuth Token',
                  type: 'secret',
                  required: true,
                },
                {
                  key: 'signingSecret',
                  label: 'Signing secret',
                  type: 'secret',
                  required: true,
                },
              ],
              oauthConnect: {
                label: 'Connect with Slack',
                startUrl: '/api/connections/slack/oauth/start',
              },
              connectionUi: {
                requiresPublicIngress: true,
                publicIngressDescription:
                  'Larkup Proxy securely forwards Slack messages to this HTTPS address after you connect.',
              },
              managedConnection: {
                relay: {
                  workspaceIdField: 'workspaceId',
                  relaySecretField: 'relaySecret',
                },
              },
              supportsStreaming: false,
              supportsWebhookRegistration: false,
              availability: 'available',
            },
            {
              id: 'telegram',
              name: 'Telegram',
              description: 'Answer Telegram messages.',
              icon: '/icons/telegram.png',
              configFields: [
                { key: 'botToken', label: 'Bot token', type: 'secret', required: true },
                {
                  key: 'webhookSecret',
                  label: 'Webhook secret',
                  type: 'secret',
                  required: true,
                  canGenerate: true,
                },
              ],
              connectionUi: {
                credentialsDescription:
                  'Each Larkup project uses its own Telegram bot token. Larkup never sends this token to the proxy.',
              },
              supportsStreaming: false,
              supportsWebhookRegistration: true,
              availability: 'available',
            },
            {
              id: 'discord',
              name: 'Discord',
              description: 'Answer slash commands sent to your Discord application.',
              icon: '/icons/discord.png',
              configFields: [
                {
                  key: 'publicKey',
                  label: 'Application public key',
                  type: 'secret',
                  required: true,
                },
              ],
              oauthConnect: {
                label: 'Connect with Discord',
                startUrl: '/api/connections/discord/oauth/start',
                description: 'Add Larkup’s Discord app to one server.',
              },
              connectionUi: {
                requiresPublicIngress: true,
                credentialsDescription:
                  'Use this only for your own Discord application. The managed option is the quickest setup.',
              },
              managedConnection: {
                relay: {
                  workspaceIdField: 'guildId',
                  relaySecretField: 'relaySecret',
                },
              },
              supportsStreaming: false,
              supportsWebhookRegistration: false,
              availability: 'available',
            },
          ],
          connections: [
            ...(slackConnected
              ? [
                  {
                    id: 'slack',
                    enabled: true,
                    managed: true,
                    settings: {},
                    target: { mode: 'local', endpoint: 'http://localhost:8080' },
                  },
                ]
              : []),
            {
              id: 'discord',
              enabled: true,
              managed: true,
              settings: {},
              provider: {
                testUrl: 'https://discord.com/channels/123456789012345678',
                testUrlLabel: 'Open Discord server',
              },
              target: { mode: 'local', endpoint: 'http://localhost:8080' },
            },
          ],
        }),
      });
    });

    await page.goto('/settings?section=runtime&tab=connections');

    const slackCard = page.getByTestId('connection-card').filter({ hasText: 'Slack' });
    const telegramCard = page.getByTestId('connection-card').filter({ hasText: 'Telegram' });
    const discordCard = page.getByTestId('connection-card').filter({ hasText: 'Discord' });
    await expect(page.getByLabel('Search connections')).toBeVisible();
    await page.getByLabel('Search connections').fill('Telegram');
    await expect(slackCard).toHaveCount(0);
    await expect(telegramCard).toBeVisible();
    await page.getByLabel('Search connections').fill('');
    await page.getByRole('button', { name: 'Ask for a connection', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Request a connection');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(slackCard.getByRole('button', { name: 'Configure', exact: true })).toBeVisible();
    await expect(telegramCard.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await expect(discordCard.getByRole('button', { name: 'Configure', exact: true })).toBeVisible();

    await discordCard.getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Reconnect Discord', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Add Larkup’s Discord app to one server.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Discord server', exact: true }),
    ).toHaveAttribute('href', 'https://discord.com/channels/123456789012345678');
    await page.keyboard.press('Escape');

    page.on('dialog', (dialog) => dialog.accept());
    await slackCard.getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'OAuth', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reconnect Slack', exact: true })).toBeEnabled();
    await expect(
      page.getByText('Choose OAuth for the managed setup, or Credentials when using your own app.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Use ngrok', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Set up ngrok' })).toBeVisible();
    await page.getByLabel('ngrok authtoken').fill('test-ngrok-token');
    await page.getByRole('button', { name: 'Generate HTTPS', exact: true }).click();
    await expect(page.getByText('https://project.ngrok.app', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check setup', exact: true }).click();
    await expect.poll(() => managedCheckPayload?.managed).toBe(true);
    await page.getByRole('tab', { name: 'Credentials', exact: true }).click();
    await expect(page.getByLabel('Bot User OAuth Token *')).toBeVisible();
    await expect(page.getByLabel('Signing secret *')).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(slackCard.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();

    await telegramCard.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText('1. Choose the Agent')).toBeVisible();
    await expect(page.getByText('2. Connect Telegram')).toBeVisible();
    await expect(page.getByText('3. Save and test')).toBeVisible();
    await expect(
      page.getByText('Each Larkup project uses its own Telegram bot token.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  });

  test('keeps the selected runtime tab in the URL across refreshes', async ({ page }) => {
    await page.goto('/settings?section=runtime&tab=deployments');
    await expect(page.getByText('No remote deployments saved yet.')).toBeVisible();
    await expect(page).toHaveURL(/section=runtime&tab=deployments/);

    await page.reload();
    await expect(page.getByText('No remote deployments saved yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Server', exact: true }).click();
    await expect(page).toHaveURL(/section=runtime&tab=server/);
    await expect(page.getByRole('heading', { name: 'Larkup Server', exact: true })).toBeVisible();
  });

  test('offers endpoint, API key, and remove actions for cloud deployments', async ({
    page,
    context,
  }) => {
    let removed = false;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      window.localStorage.setItem('larkup-deployment-api-key:deployment-1', 'deployment-api-key');
    });
    await page.route('**/api/projects/deployments', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            deployments: removed
              ? []
              : [
                  {
                    id: 'deployment-1',
                    name: 'Vercel Agent',
                    provider: 'Vercel',
                    profile: 'assistant',
                    endpoint: 'https://agent.example.com',
                    status: 'ready',
                  },
                ],
          }),
        });
        return;
      }
      if (route.request().method() === 'DELETE') {
        removed = true;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ deleted: true }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/settings?section=runtime&tab=deployments');
    await page.getByRole('button', { name: 'Copy API endpoint for Vercel deployment' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('https://agent.example.com');

    await page.getByRole('button', { name: 'Copy API key for Vercel deployment' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('deployment-api-key');

    await page.getByRole('button', { name: 'Remove Vercel deployment' }).click();
    await expect(page.getByRole('heading', { name: 'Remove this deployment?' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('No remote deployments saved yet.')).toBeVisible();
  });

  test('runs the unified Knowledge or Agent server and keeps runtime integrations together', async ({
    page,
  }) => {
    await page.route(/\/api\/projects\/runtime(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ runtime: { running: false, endpoint: 'http://localhost:8080' } }),
      });
    });
    await page.route(/\/api\/config(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        body: JSON.stringify({ config: { ...data.config, runtimeProfile: 'assistant' } }),
      });
    });
    await page.goto('/settings?section=runtime');
    await expect(page.getByRole('heading', { name: 'Larkup Server', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Launch server', exact: true })).toBeVisible();
    await expect(page.getByLabel('Run as Agent Server')).toBeVisible();
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(
      page.getByText(
        'Connect a provider once, choose the Agent that replies, then send a real test message.',
      ),
    ).toBeVisible();
    await page
      .getByTestId('connection-card-widget')
      .getByRole('button', { name: 'Customize' })
      .click();
    await expect(page.getByRole('button', { name: 'React', exact: true })).toBeVisible();
    await expect(page.getByLabel('Show API key')).toBeVisible();
    await page.getByRole('button', { name: 'React', exact: true }).click();
    await expect(page.getByText('export function LarkupWidget', { exact: false })).toBeVisible();
  });

  test('requires stopping a running server before changing its profile', async ({ page }) => {
    await page.route('**/api/projects/runtime', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: { running: true, endpoint: 'http://localhost:8080', port: 8080 },
        }),
      });
    });
    await page.route('**/api/config', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();

      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        body: JSON.stringify({ config: { ...data.config, runtimeProfile: 'assistant' } }),
      });
    });

    await page.goto('/settings?section=runtime');
    const profileSwitch = page.getByLabel('Run as Agent Server');
    await expect(profileSwitch).toBeChecked();

    await profileSwitch.click();

    await expect(
      page.getByText('Stop the server before switching between Knowledge and Agent modes.'),
    ).toBeVisible();
    await expect(profileSwitch).toBeChecked();
  });

  test('opens widget customization from Connections', async ({ page }) => {
    await page.goto('/settings?section=runtime&tab=connections');
    await expect(page.getByTestId('connection-card-widget')).toBeVisible();
    await page
      .getByTestId('connection-card-widget')
      .getByRole('button', { name: 'Customize' })
      .click();
    await expect(page.getByRole('button', { name: 'React', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to connections', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Ask for a connection', exact: true }),
    ).toBeVisible();
  });

  test('keeps the running server view minimal while preserving connection actions', async ({
    page,
    context,
  }) => {
    await page.route('**/api/projects/runtime', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          runtime: { running: true, endpoint: 'http://localhost:8080', port: 8080 },
        }),
      });
    });

    await page.goto('/settings?section=runtime');

    await expect(
      page.getByRole('button', { name: 'Copy TypeScript SDK', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Python SDK', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy cURL', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'API reference', exact: true })).toBeVisible();
    await expect(page.getByText('TypeScript SDK code', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Python SDK code', { exact: true })).not.toBeVisible();
    await expect(page.locator('pre')).toHaveCount(0);

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy TypeScript SDK', exact: true }).click();
    await expect(page.getByText('TypeScript SDK code copied.')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('Knowledge Server');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('Agent Server');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('streamText');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('chatModelCatalog');

    await page.getByRole('button', { name: 'Copy Python SDK', exact: true }).click();
    await expect(page.getByText('Python SDK code copied.')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('LarkupAgentClient');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('stream_text');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('chat_model_catalog');
  });

  test('uses the selected provider identity and creates the remote URL during deployment', async ({
    page,
  }) => {
    await page.goto('/settings?section=runtime&deployTarget=Vercel');
    await expect(
      page.getByRole('heading', { name: /Deploy (Knowledge|Agent) to Vercel/ }),
    ).toBeVisible();
    await expect(page.getByText('Project Details', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Remote deployment link')).toHaveCount(0);
    await expect(page.getByText(/^Vercel Token/)).toBeVisible();
  });

  test('allows a deployment-specific AI chat provider and API key', async ({ page }) => {
    await page.goto('/settings?section=runtime&deployTarget=Vercel');
    await page.getByText('Server Configuration', { exact: true }).click();

    await expect(page.getByText('AI chat runtime', { exact: true })).toBeVisible();
    const chatRuntime = page.getByText('AI chat runtime', { exact: true }).locator('../..');
    await chatRuntime.getByRole('combobox').click();
    await page.getByRole('listbox').getByText('DeepSeek', { exact: true }).click();
    await expect(page.getByText('DeepSeek API key', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Paste a deployment-only API key')).toBeVisible();
  });
});
