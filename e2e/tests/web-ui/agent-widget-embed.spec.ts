import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { test, expect, type Page, type Request } from '@playwright/test';
import { WEB_UI_URL } from '../../playwright.config';

/**
 * TASK 05 — the widget as a customer actually experiences it.
 *
 * The API-level gate is covered in `tests/api/agent-widget.spec.ts`. This spec
 * proves the browser half: a page on a *different origin* loads the bundle,
 * mounts into a Shadow DOM, survives a hostile host stylesheet, and either
 * chats or explains itself when the origin is blocked.
 *
 * Two throwaway HTTP servers stand in for customer websites. They are real
 * servers rather than `page.route()` fulfilments because Chrome's Private
 * Network Access rules block a synthetic "public" page from loading a loopback
 * script — a fake origin cannot reach the dev server, but a real loopback one
 * can, and it still counts as cross-origin for CORS.
 */

/**
 * A host page that fights the widget: forced fonts, colors, `position: static`,
 * squared corners. If the bubble still looks right, Shadow DOM held.
 */
function hostPage(agentId: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Embed harness</title>
<style>
  * { font-family: 'Comic Sans MS', cursive !important; letter-spacing: 4px !important; }
  div { position: static !important; border: 3px dashed magenta !important; }
  button { background: lime !important; border-radius: 0 !important; width: 300px !important; }
  body { background: #101322; color: #fff; }
</style></head>
<body>
  <h1 id="host-heading">Host page</h1>
  <script src="${WEB_UI_URL}/api/widget.js" data-agent="${agentId}"></script>
</body></html>`;
}

async function startHostSite(
  getAgentId: () => string,
): Promise<{ server: Server; origin: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(hostPage(getAgentId()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://localhost:${port}` };
}

let agentId = '';
let allowedSite: { server: Server; origin: string };
let blockedSite: { server: Server; origin: string };
let bundleAvailable = true;

const launcher = '[data-larkup-agent] .lk-launcher';
const panel = '[data-larkup-agent] .lk-panel';

test.describe.serial('Agent widget embed (TASK 05)', () => {
  test.beforeAll(async ({ request }) => {
    const bundle = await request.get('/api/widget.js');
    bundleAvailable = bundle.status() === 200;

    // Both sites must exist before the agent is created: the allow-list has to
    // name the exact port the OS hands us.
    allowedSite = await startHostSite(() => agentId);
    blockedSite = await startHostSite(() => agentId);

    const res = await request.post('/api/agents', {
      data: {
        name: `Widget Embed E2E ${Date.now()}`,
        systemPrompt: 'You are a test agent.',
        allowedOrigins: [allowedSite.origin],
        widgetStyle: {
          primaryColor: '#0ea5e9',
          position: 'bottom-right',
          title: 'Acme Support',
          welcomeMessage: 'Ask me anything about Acme.',
          placeholder: 'Write here…',
          darkMode: false,
          borderRadius: 'lg',
        },
      },
    });
    expect(res.status()).toBe(201);
    agentId = (await res.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (agentId) await request.delete(`/api/agents/${agentId}`);
    allowedSite?.server.close();
    blockedSite?.server.close();
  });

  test.beforeEach(() => {
    test.skip(
      !bundleAvailable,
      'widget bundle not built — run `pnpm --filter @larkup/agent-widget build`',
    );
  });

  /**
   * Stub `/api/agents/:id/public` with a canned response.
   *
   * Every test mounts the widget fresh, which fetches this endpoint on load.
   * All tests here share one agent id, one real source IP, and one browser
   * User-Agent — exactly the plan §8.5 visitor-rate-limit bucket key
   * (`agent-rate-limit.ts`) — so this file's full real request volume would
   * exceed the 5-request burst. Most tests here do not care what the config
   * *contains*, only that the widget mounts, so they stub it — the same
   * reasoning `stubChat` below already applies to the chat endpoint. The
   * handful of tests that specifically prove the real fetch (styling,
   * publish status) call `request` directly instead of using this stub.
   */
  async function stubPublicConfig(page: Page, overrides: Partial<Record<string, unknown>> = {}) {
    await page.route(`${WEB_UI_URL}/api/agents/*/public`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin },
        contentType: 'application/json',
        body: JSON.stringify({
          agentId,
          name: 'Stubbed Agent',
          status: 'ready',
          authMode: 'none',
          widgetStyle: {
            primaryColor: '#0ea5e9',
            position: 'bottom-right',
            title: 'Chat with us',
            welcomeMessage: 'Hi there',
            placeholder: 'Type a message…',
            darkMode: false,
            borderRadius: 'lg',
          },
          ...overrides,
        }),
      });
    });
  }

  test('mounts a launcher on an allow-listed third-party page', async ({ page }) => {
    await stubPublicConfig(page);
    await page.goto(`${allowedSite.origin}/`);

    await expect(page.locator(launcher)).toBeVisible();

    // The mount point must be a real shadow root, not a plain div.
    const hasShadowRoot = await page.evaluate(
      () => !!document.querySelector('[data-larkup-agent]')?.shadowRoot,
    );
    expect(hasShadowRoot).toBe(true);
  });

  test('resists the host page stylesheet', async ({ page }) => {
    await stubPublicConfig(page);
    await page.goto(`${allowedSite.origin}/`);
    await expect(page.locator(launcher)).toBeVisible();

    const computed = await page.locator(launcher).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        borderRadius: style.borderRadius,
        width: style.width,
        fontFamily: style.fontFamily,
        letterSpacing: style.letterSpacing,
      };
    });

    // The host forced `border-radius: 0`, `width: 300px`, Comic Sans and 4px
    // letter-spacing on every button. None of it may reach inside the shadow.
    expect(computed.borderRadius).not.toBe('0px');
    expect(computed.width).toBe('56px');
    expect(computed.fontFamily.toLowerCase()).not.toContain('comic');
    expect(computed.letterSpacing).not.toBe('4px');
  });

  test('does not leak its own styles back into the host page', async ({ page }) => {
    await stubPublicConfig(page);
    await page.goto(`${allowedSite.origin}/`);
    await expect(page.locator(launcher)).toBeVisible();

    // The host's own heading keeps the host's rules.
    const heading = await page
      .locator('#host-heading')
      .evaluate((el) => getComputedStyle(el).letterSpacing);
    expect(heading).toBe('4px');

    // And no widget markup escaped into the light DOM.
    expect(await page.locator('body > .lk-root').count()).toBe(0);
  });

  test('opens a styled panel using the agent dashboard configuration', async ({ page }) => {
    await page.goto(`${allowedSite.origin}/`);
    await page.locator(launcher).click();
    await expect(page.locator(panel)).toBeVisible();

    // Title, welcome copy and placeholder all come from the server's public
    // config — proof the cross-origin fetch succeeded.
    await expect(page.locator('[data-larkup-agent] .lk-title')).toHaveText('Acme Support');
    await expect(page.locator('[data-larkup-agent] .lk-empty')).toContainText(
      'Ask me anything about Acme.',
    );
    await expect(page.locator('[data-larkup-agent] .lk-input')).toHaveAttribute(
      'placeholder',
      'Write here…',
    );

    const accent = await page.locator(panel).evaluate((el) =>
      getComputedStyle(el.closest('.lk-root') as Element)
        .getPropertyValue('--lk-primary')
        .trim(),
    );
    expect(accent).toBe('#0ea5e9');
  });

  test('warns that an unpublished agent cannot answer', async ({ page }) => {
    await page.goto(`${allowedSite.origin}/`);
    await page.locator(launcher).click();

    await expect(page.locator('[data-larkup-agent] .lk-notice')).toContainText(
      'no published release',
    );
  });

  test('closes on Escape', async ({ page }) => {
    await stubPublicConfig(page);
    await page.goto(`${allowedSite.origin}/`);
    await page.locator(launcher).click();
    await expect(page.locator(panel)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(panel)).toHaveCount(0);
  });

  /* ---------------------------------------------------------------- */
  /* Streaming, with the model stubbed out                             */
  /* ---------------------------------------------------------------- */

  /**
   * Replace the chat endpoint with a canned UI Message Stream.
   *
   * This is the only way to exercise streaming, tool status blocks, citations
   * and multi-turn history without a live model credential — and it pins the
   * exact wire format the widget's parser is written against.
   */
  async function stubChat(page: Page, seen: Request[]) {
    const frames = [
      { type: 'start' },
      { type: 'text-start', id: '0' },
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'search_docs' },
      { type: 'text-delta', id: '0', delta: 'Order 4471 ' },
      { type: 'tool-output-available', toolCallId: 't1', output: { hits: 2 } },
      { type: 'text-delta', id: '0', delta: 'shipped on Tuesday.' },
      {
        type: 'source-url',
        sourceId: 's1',
        url: 'https://acme.test/orders',
        title: 'Order policy',
      },
      { type: 'text-end', id: '0' },
      { type: 'finish' },
    ];

    await page.route(`${WEB_UI_URL}/api/agents/*/chat`, async (route) => {
      seen.push(route.request());
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Access-Control-Allow-Origin': new URL(page.url()).origin,
        },
        body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n',
      });
    });
  }

  test('streams an answer with tool status and citation blocks', async ({ page }) => {
    const seen: Request[] = [];
    await stubPublicConfig(page);
    await stubChat(page, seen);
    await page.goto(`${allowedSite.origin}/`);
    await page.locator(launcher).click();

    await page.locator('[data-larkup-agent] .lk-input').fill('Where is order 4471?');
    await page.locator('[data-larkup-agent] .lk-send').click();

    await expect(page.locator('[data-larkup-agent] .lk-msg--user .lk-bubble')).toHaveText(
      'Where is order 4471?',
    );
    await expect(page.locator('[data-larkup-agent] .lk-msg--assistant .lk-bubble')).toContainText(
      'Order 4471 shipped on Tuesday.',
    );

    // The tool block resolves in place rather than stacking a second entry.
    const status = page.locator('[data-larkup-agent] .lk-block-status');
    await expect(status).toHaveCount(1);
    await expect(status).toHaveClass(/lk-block-status--done/);
    await expect(status).toContainText('search_docs');

    const citation = page.locator('[data-larkup-agent] .lk-citation');
    await expect(citation).toContainText('Order policy');
    await expect(citation).toHaveAttribute('href', 'https://acme.test/orders');
    // target=_blank without noopener hands window.opener to a third party.
    await expect(citation).toHaveAttribute('rel', /noopener/);
  });

  test('sends the full conversation history on a follow-up turn', async ({ page }) => {
    const seen: Request[] = [];
    await stubPublicConfig(page);
    await stubChat(page, seen);
    await page.goto(`${allowedSite.origin}/`);
    await page.locator(launcher).click();

    const input = page.locator('[data-larkup-agent] .lk-input');
    const send = page.locator('[data-larkup-agent] .lk-send');

    await input.fill('first question');
    await send.click();
    await expect(page.locator('[data-larkup-agent] .lk-msg--assistant .lk-bubble')).toContainText(
      'shipped on Tuesday',
    );

    await input.fill('second question');
    await send.click();
    await expect(page.locator('[data-larkup-agent] .lk-msg--user')).toHaveCount(2);

    expect(seen).toHaveLength(2);
    expect(seen[0].postDataJSON().messages).toEqual([{ role: 'user', content: 'first question' }]);
    // The regression this guards: reading history from a setState updater sent
    // an empty conversation, so the agent lost all context after turn one.
    expect(seen[1].postDataJSON().messages).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'Order 4471 shipped on Tuesday.' },
      { role: 'user', content: 'second question' },
    ]);
  });

  test('starts a fresh conversation on reset', async ({ page }) => {
    const seen: Request[] = [];
    await stubPublicConfig(page);
    await stubChat(page, seen);
    await page.goto(`${allowedSite.origin}/`);
    await page.locator(launcher).click();

    await page.locator('[data-larkup-agent] .lk-input').fill('hello');
    await page.locator('[data-larkup-agent] .lk-send').click();
    await expect(page.locator('[data-larkup-agent] .lk-msg')).toHaveCount(2);

    await page.locator('[data-larkup-agent] .lk-icon-btn').first().click();
    await expect(page.locator('[data-larkup-agent] .lk-msg')).toHaveCount(0);
    await expect(page.locator('[data-larkup-agent] .lk-empty')).toBeVisible();

    await page.locator('[data-larkup-agent] .lk-input').fill('brand new');
    await page.locator('[data-larkup-agent] .lk-send').click();
    await expect(page.locator('[data-larkup-agent] .lk-msg--user')).toHaveCount(1);
    expect(seen[1].postDataJSON().messages).toEqual([{ role: 'user', content: 'brand new' }]);
  });

  test('explains itself instead of failing silently on a blocked origin', async ({ page }) => {
    await page.goto(`${blockedSite.origin}/`);
    await page.locator(launcher).click();

    const notice = page.locator('[data-larkup-agent] .lk-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('allowed origins');

    // A blocked embed must not offer a chat box that would only 403.
    await expect(page.locator('[data-larkup-agent] .lk-input')).toBeDisabled();
  });
});
