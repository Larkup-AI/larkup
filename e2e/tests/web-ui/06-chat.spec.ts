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

      // Answers retain a compact citations area. It intentionally stays empty
      // when the agent has no supporting evidence to present.
      await expect(page.getByTestId('chat-citations')).toBeVisible({ timeout: 15_000 });
      const citationList = page.getByTestId('citation-list');
      if (await citationList.isVisible()) {
        expect(await citationList.locator('a, button').count()).toBeGreaterThan(0);
      } else {
        await expect(citationList).toBeHidden();
      }
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

    await page.getByRole('button', { name: 'Chat history' }).click();

    await expect(page.getByRole('heading', { name: 'Chat History' })).toBeVisible();
    const clearHistory = page.getByRole('button', { name: 'Clear chat history' });
    await expect(clearHistory).toBeVisible();

    if (await clearHistory.isEnabled()) {
      await clearHistory.click();
      await expect(page.getByRole('alertdialog')).toContainText('Delete all chat history');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    }
  });

  test('answer feedback survives reload and remains mutually exclusive', async ({ page }) => {
    const chatId = `feedback-${Date.now()}`;
    await page.evaluate(
      async ({ chatId }) => {
        const messages = [
          {
            id: 'feedback-question',
            role: 'user',
            parts: [{ type: 'text', text: 'Which answer did I rate?' }],
          },
          {
            id: 'feedback-answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-searchKnowledgeBase',
                state: 'output-available',
                input: { query: 'Which answer did I rate?' },
                output: {
                  hits: [
                    {
                      documentId: 'feedback-source',
                      title: 'Feedback source',
                      text: 'This answer keeps its rating after reload.',
                    },
                  ],
                },
              },
              { type: 'text', text: 'This answer keeps its rating after reload.' },
            ],
          },
        ];
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('keyval-store', 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('keyval')) {
              request.result.createObjectStore('keyval');
            }
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const transaction = request.result.transaction('keyval', 'readwrite');
            transaction.objectStore('keyval').put(messages, `chat_messages_${chatId}`);
            transaction.oncomplete = () => {
              request.result.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
        });
      },
      { chatId },
    );

    await page.goto(`/chat/${chatId}`);
    await expect(page.getByText('This answer keeps its rating after reload.')).toBeVisible();

    const likeSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/chat/feedback') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Like', exact: true }).click();
    expect((await likeSaved).ok()).toBe(true);
    await expect(
      page.getByRole('button', { name: /Liked — saved with this chat/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Liked — saved with this chat/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    const dislikeSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/chat/feedback') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Dislike', exact: true }).click();
    const dislikeResponse = await dislikeSaved;
    expect(dislikeResponse.ok()).toBe(true);
    expect(await dislikeResponse.json()).toMatchObject({ cached: false, removed: true });
    await expect(
      page.getByRole('button', { name: /Disliked — cached answer removed/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Disliked — cached answer removed/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('generated charts show names for both axes', async ({ page }) => {
    const chatId = `axis-labels-${Date.now()}`;
    await page.evaluate(
      async ({ chatId }) => {
        const messages = [
          {
            id: 'chart-question',
            role: 'user',
            parts: [{ type: 'text', text: 'Create a graph based on that' }],
          },
          {
            id: 'chart-answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-generateVisualization',
                state: 'output-available',
                input: {},
                output: {
                  chartType: 'line',
                  title: 'Monthly Sales and Profit Trends',
                  data: [
                    { month: '2024-12', revenue: 0 },
                    { month: '2025-01', revenue: 225000 },
                    { month: '2025-12', revenue: 210000 },
                  ],
                  xAxisKey: 'month',
                  xAxisLabel: 'Date month',
                  yAxisLabel: 'Net Revenue',
                  series: [{ dataKey: 'revenue', label: 'Monthly Net Revenue' }],
                  showLegend: true,
                },
              },
              { type: 'text', text: 'The modeled rates decline over time.' },
            ],
          },
        ];
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('keyval-store', 1);
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('keyval')) {
              request.result.createObjectStore('keyval');
            }
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const transaction = request.result.transaction('keyval', 'readwrite');
            transaction.objectStore('keyval').put(messages, `chat_messages_${chatId}`);
            transaction.oncomplete = () => {
              request.result.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
        });
      },
      { chatId },
    );

    await page.goto(`/chat/${chatId}`);
    const chart = page.locator('.recharts-wrapper');
    await expect(chart).toBeVisible();
    await expect(chart.getByText('Date month', { exact: true })).toBeVisible();
    await expect(chart.getByText('Net Revenue', { exact: true })).toBeVisible();

    const spacing = await chart.evaluate((element) => {
      const rect = (node: Element | null) => node?.getBoundingClientRect() ?? null;
      const findText = (root: Element | null, value: string) =>
        Array.from(root?.querySelectorAll('*') ?? [])
          .reverse()
          .find((node) => node.textContent?.trim() === value) ?? null;
      const axisText = Array.from(element.querySelectorAll('text'));
      const findAxisText = (value: string) =>
        axisText.find((node) => node.textContent?.trim() === value) ?? null;
      const xLabel = rect(findAxisText('Date month'));
      const yLabel = rect(findAxisText('Net Revenue'));
      const legendLabel = rect(findText(element, 'Monthly Net Revenue'));
      const xTicks = axisText
        .filter((node) => /^202[45]-\d{2}$/.test(node.textContent?.trim() ?? ''))
        .map((node) => node.getBoundingClientRect());
      const yTicks = axisText
        .filter((node) => /^\d+(?:\.\d+)?$/.test(node.textContent?.trim() ?? ''))
        .map((node) => node.getBoundingClientRect());

      const missing = [
        !xLabel && 'xLabel',
        !yLabel && 'yLabel',
        !legendLabel && 'legendLabel',
        xTicks.length === 0 && 'xTicks',
        yTicks.length === 0 && 'yTicks',
      ].filter(Boolean);

      return {
        missing,
        xTickToLabel:
          xLabel && xTicks.length > 0
            ? xLabel.top - Math.max(...xTicks.map((tick) => tick.bottom))
            : null,
        xLabelToLegend: xLabel && legendLabel ? legendLabel.top - xLabel.bottom : null,
        yLabelToTicks:
          yLabel && yTicks.length > 0
            ? Math.min(...yTicks.map((tick) => tick.left)) - yLabel.right
            : null,
      };
    });

    expect(spacing.missing).toEqual([]);
    expect(spacing.xTickToLabel).toBeGreaterThanOrEqual(24);
    expect(spacing.xLabelToLegend).toBeGreaterThanOrEqual(8);
    expect(spacing.yLabelToTicks).toBeGreaterThanOrEqual(24);
  });
});
