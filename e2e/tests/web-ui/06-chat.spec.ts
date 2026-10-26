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

  test('opens job tracking from a compact chat header button', async ({ page }) => {
    const jobsButton = page.getByRole('button', { name: /Jobs tracking/i });
    const historyButton = page.getByRole('button', { name: 'Chat history' });
    await expect(jobsButton).toBeVisible();
    await expect(historyButton).toBeVisible();

    const [jobsBox, historyBox] = await Promise.all([
      jobsButton.boundingBox(),
      historyButton.boundingBox(),
    ]);
    expect(jobsBox?.width).toBe(historyBox?.width);
    expect(jobsBox?.height).toBe(historyBox?.height);

    await jobsButton.click();
    await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible();
    await expect(
      page
        .getByText(/background jobs? active/i)
        .or(page.getByText('Track indexing and website jobs')),
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

  test('long tabular answers stay compact and disclose returned coverage', async ({ page }) => {
    const chatId = `long-table-${Date.now()}`;
    await page.evaluate(
      async ({ chatId }) => {
        const messages = [
          {
            id: 'table-question',
            role: 'user',
            parts: [{ type: 'text', text: 'Show me the top 300 participants' }],
          },
          {
            id: 'table-answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-queryTabularData',
                state: 'output-available',
                input: {},
                output: {
                  columns: ['Rank', 'Participant', 'Score'],
                  rows: Array.from({ length: 300 }, (_, index) => ({
                    Rank: index + 1,
                    Participant: `Participant ${index + 1}`,
                    Score: 1_000 - index,
                  })),
                  totalRows: 1_000,
                  truncated: true,
                },
              },
              { type: 'text', text: 'The requested ranked results are in the table.' },
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
    const tableSummary = page.getByRole('button', {
      name: /Data checked 300 of 1,000 rows/,
    });
    await expect(tableSummary).toBeVisible();
    await tableSummary.click();
    await expect(page.getByText('300 shown of 1,000 matching rows')).toBeVisible();
    await expect(page.getByText('Participant 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Participant 11', { exact: true })).not.toBeVisible();
  });

  test('sandbox artifacts render complete tables and paged long text', async ({ page }) => {
    const chatId = `analysis-artifacts-${Date.now()}`;
    await page.evaluate(
      async ({ chatId }) => {
        const messages = [
          {
            id: 'artifact-question',
            role: 'user',
            parts: [{ type: 'text', text: 'Prepare matches for 25 participants' }],
          },
          {
            id: 'artifact-answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-executeAnalysis',
                state: 'output-available',
                input: {},
                output: {
                  stdout: '',
                  stderr: '',
                  exitCode: 0,
                  executionTimeMs: 120,
                  artifacts: [],
                  presentation: {
                    kind: 'table',
                    title: 'Participant matches',
                    summary: 'Three constrained matches for every requested participant.',
                    columns: ['Participant', 'Match 1', 'Reason'],
                    rows: Array.from({ length: 25 }, (_, index) => ({
                      Participant: `Participant ${index + 1}`,
                      'Match 1': `Candidate ${index + 1}`,
                      Reason: `Reason for participant ${index + 1}`,
                    })),
                    totalItems: 25,
                    requestedItems: 25,
                    complete: true,
                    fileName: 'participant-matches.csv',
                  },
                },
              },
              {
                type: 'tool-analyzeCorpusWithCode',
                state: 'output-available',
                input: {},
                output: {
                  stdout: '',
                  stderr: '',
                  exitCode: 0,
                  executionTimeMs: 90,
                  artifacts: [],
                  presentation: {
                    kind: 'document',
                    title: 'Prepared report',
                    summary: 'A paged narrative result.',
                    pages: [
                      { title: 'Opening', content: 'First prepared section.' },
                      { title: 'Findings', content: 'Second prepared section.' },
                      { title: 'Conclusion', content: 'Third prepared section.' },
                    ],
                    totalItems: 3,
                    requestedItems: 3,
                    complete: true,
                    fileName: 'prepared-report.txt',
                  },
                },
              },
              { type: 'text', text: 'Both complete results are ready below.' },
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
    await expect(page.getByText('Participant matches', { exact: true })).toBeVisible();
    await expect(page.getByText('25 of 25 prepared', { exact: true })).toBeVisible();
    await expect(page.getByText('Participant 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Participant 11', { exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: 'Next table page' }).click();
    await expect(page.getByText('Participant 11', { exact: true })).toBeVisible();

    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    expect((await csvDownload).suggestedFilename()).toBe('participant-matches.csv');

    await expect(page.getByText('First prepared section.')).toBeVisible();
    await page.getByRole('button', { name: 'Next prepared page' }).click();
    await expect(page.getByText('Second prepared section.')).toBeVisible();
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
  });

  test('analysis failures, empty output, and long-form coverage remain visible', async ({
    page,
  }) => {
    const chatId = `analysis-edge-states-${Date.now()}`;
    await page.evaluate(
      async ({ chatId }) => {
        const messages = [
          {
            id: 'edge-question',
            role: 'user',
            parts: [{ type: 'text', text: 'Prepare three matches for all 25 participants' }],
          },
          {
            id: 'edge-answer',
            role: 'assistant',
            parts: [
              {
                type: 'tool-executeAnalysis',
                state: 'output-error',
                input: {},
                errorText: 'provider detail that must not be exposed',
              },
              {
                type: 'tool-executeAnalysis',
                state: 'output-available',
                input: {},
                output: {
                  stdout: '',
                  stderr: '',
                  exitCode: 0,
                  executionTimeMs: 40,
                  artifacts: [],
                },
              },
              {
                type: 'tool-executeAnalysis',
                state: 'output-available',
                input: {},
                output: {
                  stdout: '',
                  stderr: '',
                  exitCode: 0,
                  executionTimeMs: 80,
                  artifacts: [],
                  presentation: {
                    kind: 'table',
                    title: 'Long-form matches',
                    columns: ['Participant', 'Match', 'Email', 'Reason'],
                    rows: Array.from({ length: 75 }, (_, index) => ({
                      Participant: `Participant ${Math.floor(index / 3) + 1}`,
                      Match: `Candidate ${index + 1}`,
                      Email: `candidate${index + 1}@example.test`,
                      Reason: `A complete explanation for match ${index + 1}.`,
                    })),
                    totalItems: 75,
                    requestedItems: 25,
                    complete: true,
                  },
                },
              },
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
    await expect(page.getByText('Analysis encountered an issue', { exact: true })).toBeVisible();
    await expect(page.getByText('provider detail that must not be exposed')).not.toBeVisible();
    await expect(
      page.getByText('Analysis completed without a usable result', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Long-form matches', { exact: true })).toBeVisible();
    await expect(page.getByText('25 of 25 prepared · 75 rows', { exact: true })).toBeVisible();
    await expect(
      page.getByText('A complete explanation for match 1.', { exact: true }),
    ).toBeVisible();
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
    const chartCard = page.getByTestId('chat-chart');
    await expect(chartCard).toBeVisible();
    expect((await chartCard.boundingBox())?.height).toBeLessThan(400);

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
    expect(spacing.xTickToLabel).toBeGreaterThanOrEqual(12);
    expect(spacing.xTickToLabel).toBeLessThanOrEqual(28);
    expect(spacing.xLabelToLegend).toBeGreaterThanOrEqual(6);
    expect(spacing.xLabelToLegend).toBeLessThanOrEqual(20);
    expect(spacing.yLabelToTicks).toBeGreaterThanOrEqual(8);
    expect(spacing.yLabelToTicks).toBeLessThanOrEqual(34);
  });
});
