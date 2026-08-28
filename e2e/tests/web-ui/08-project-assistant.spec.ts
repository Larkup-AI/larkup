import { test, expect } from '@playwright/test';

test.describe('Assistant customization', () => {
  test('keeps prompt, built-in tools, and plugin switches in Project customization', async ({
    page,
  }) => {
    await page.goto('/settings?section=agent-customization');
    await expect(
      page.getByRole('heading', { name: 'Agent Customization', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prompt', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.getByText('Built-in tools', { exact: true })).toBeVisible();
    await expect(page.getByText('Semantic Search', { exact: true })).toBeVisible();
  });

  test('keeps MCP and sandbox in Agent Customization line tabs', async ({ page }) => {
    await page.route('**/api/mcp', async (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connections: [] }) }),
    );
    await page.goto('/settings?section=agent-customization');
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add MCP', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
    await expect(page.getByText('Code execution', { exact: true })).toBeVisible();
  });

  test('uses the local sandbox without Docker by default', async ({ page }) => {
    await page.route('**/api/sandbox/verify', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'local',
            status: 'ready',
            message: 'Ready for code execution.',
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto('/settings?section=agent-customization');
    await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
    await expect(page.getByText('Current sandbox is ready', { exact: true })).toBeVisible();
    await expect(page.getByText('Local Sandbox', { exact: true }).first()).toBeVisible();
  });

  test('does not save sandbox settings when verification fails', async ({ page }) => {
    let configSaveAttempted = false;
    await page.route('**/api/sandbox/verify', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid API key' }),
        });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/config', async (route) => {
      if (route.request().method() === 'PUT') configSaveAttempted = true;
      await route.continue();
    });

    await page.goto('/settings?section=agent-customization');
    await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
    await page.getByRole('combobox').click();
    await page.getByText('E2B', { exact: true }).click();
    await page.getByRole('button', { name: 'Save sandbox settings', exact: true }).click();

    await expect(page.getByText('Invalid API key', { exact: true })).toBeVisible();
    expect(configSaveAttempted).toBe(false);
  });

  test('adds portable and remote Agent Skills', async ({ page }) => {
    await page.goto('/settings?section=agent-customization');
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByRole('button', { name: 'Add skill', exact: true }).click();
    await page.getByRole('button', { name: 'Remote skill', exact: true }).click();
    await page
      .getByLabel('Remote SKILL.md URL')
      .fill('https://example.com/skills/release/SKILL.md');
    await page.getByLabel('Skill name').fill('Release checklist');
    await page.getByRole('button', { name: 'Add skill', exact: true }).last().click();
    await expect(page.getByText('Release checklist', { exact: true })).toBeVisible();
  });
});
