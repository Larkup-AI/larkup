import { streamText, convertToModelMessages, tool, stepCountIs, type UIMessage } from 'ai';
import { z } from 'zod';
import { readConfig } from '@larkup/core/config-store';
import { readRun } from '@larkup/core/index-store';
import { refreshServerStatus } from '@larkup/core/generator/server-runtime';
import { createAdapter } from '@larkup/vector-stores/factory';
import { embedQuery } from '@larkup/core/indexing/embedder';
import { runWithServer } from '@larkup/core/workspace';
import { getModelsByType } from '@larkup/core/models-cache';
import { toChatDescriptor, getDefaultChatModel } from '@larkup/core/chat-models/registry';
import { listTabularDatasets, getTabularDataset, queryTabular } from '@larkup/core/tabular-store';
import { SandboxManager } from '@larkup/sandbox';

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { CustomModelConfig } from '@larkup/core/types';

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `You are a powerful data analysis assistant with access to a knowledge base and tabular data tools.

You have these tools:
1. "searchKnowledgeBase" — searches the private RAG knowledge base for relevant documents.
2. "queryTabularData" — queries stored tabular datasets (CSV/Excel/JSON) for exact values, aggregations, filtering, and grouping.
3. "generateVisualization" — generates interactive charts to visualize data trends.
4. "executeAnalysis" — runs Python code in a sandbox for deep statistical analysis (correlations, regressions, custom calculations).

CRITICAL RULES FOR CHARTS AND VISUALIZATIONS:
- You MUST ALWAYS use the "generateVisualization" tool to display ANY visual data, trends, or charts.
- The UI strictly requires the "generateVisualization" tool to render interactive charts. Text-based approximations will not work.
- DO NOT be lazy. You MUST populate the 'data' array in the 'generateVisualization' tool call with the exact rows of data you want to plot.
- ALWAYS call queryTabularData FIRST to get the data, THEN in your next turn, call generateVisualization with that exact data to render the chart.
- The UI renders generateVisualization output as an interactive Recharts chart.
RESPONSE FORMATTING (Analytics Style):
- Structure your responses for an analytics dashboard — be concise and insight-driven.
- Lead with the key insight or answer in bold (e.g., "**October had the highest revenue at $487,384**").
- Use "### Key Findings" or "### Summary" headers to organize sections.
- For observations, use bullet points with bold labels: "- **Peak:** October at $487K"
- When presenting multiple numbers, prefer a table or call generateVisualization — do NOT list raw numbers with dollar signs line by line.
- End with 1-2 brief, actionable follow-up suggestions.
- Keep text SHORT. Let the charts and tables do the heavy lifting.
- NEVER output long lists of numbers as plain text. Use tables or charts instead.

Guidelines:
- For basic greetings, respond conversationally without tools.
- For questions about facts or specific topics, call searchKnowledgeBase first.
- For questions about data, numbers, comparisons, or "what is the highest/lowest/average...": ALWAYS call queryTabularData to get exact answers. Never guess numerical values.
- When showing trends, distributions, or comparisons, use generateVisualization to create charts. Choose the best chart type:
  • Bar charts: comparing categories
  • Line charts: trends over time
  • Area charts: cumulative trends
  • Pie charts: proportion/share breakdowns
  • Scatter charts: correlation between two variables
  • Radar charts: multi-dimensional comparison
- For complex statistical analysis (correlations, regressions, hypothesis testing, or when data exceeds simple aggregation), use executeAnalysis with Python code.
- After showing data or charts, suggest 2-3 brief follow-up actions as short phrases (e.g., "Compare by region", "Break down Q4", "Show top products").
- Always cite your data sources. Be concise and accurate.
- IMPORTANT: When you create charts, use descriptive titles and subtitles. Include the data directly in the visualization config.
- IMPORTANT: If queryTabularData returns results, synthesize a clear answer with the exact numbers. Don't just dump raw data.

DATE HANDLING:
- Date columns store values as strings. When filtering dates, use the EXACT format shown in the column metadata (e.g. "2024-01-15" for YYYY-MM-DD format).
- For date comparisons (before/after/between), use "gt", "gte", "lt", "lte" operators with date strings in the same format as stored.
- Example: to find records after January 2024, use filter { column: "date", op: "gte", value: "2024-01-01" }.
- Example: to find records in 2024, use TWO filters: { op: "gte", value: "2024-01-01" } AND { op: "lt", value: "2025-01-01" }.
- NEVER convert dates to numbers. Always pass date filter values as strings matching the stored format.

LARGE DATASET HANDLING:
- For datasets with MORE than 10,000 rows, prefer "executeAnalysis" with pandas for complex queries (multi-step aggregations, pivots, correlations, time-series analysis).
- For simple lookups, counts, or single aggregations on any size dataset, queryTabularData is fine.
- When using executeAnalysis, the dataset is available as 'data.csv'. Use: df = pd.read_csv('data.csv')
- Always print the final results clearly. Use plt.show() for charts.
`;

/**
 * Creates an AI SDK language model instance based on the provider and model ID.
 */
function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels?: CustomModelConfig[],
) {
  if (modelId.startsWith('custom:')) {
    const customName = modelId.slice('custom:'.length);
    const custom = (customChatModels ?? []).find((m) => m.modelName === customName);
    if (custom) {
      const customProvider = createOpenAICompatible({
        name: 'custom_chat_provider',
        baseURL: custom.baseUrl,
        apiKey: custom.apiKey || apiKey || undefined,
      });
      return customProvider(custom.modelName);
    }
  }

  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case 'cohere':
      return createCohere({ apiKey })(modelName);
    case 'mistral':
      return createMistral({ apiKey })(modelName);
    case 'deepseek':
      return createDeepSeek({ apiKey })(modelName);
    case 'anthropic':
      return createAnthropic({ apiKey })(modelName);
    case 'openai':
      return createOpenAI({ apiKey })(modelName);
    case 'vercel_ai_gateway':
    default:
      return createGateway({ apiKey })(modelId);
  }
}

/**
 * Retrieves documents from the knowledge base — either via the running
 * generated server or directly from the local vector store.
 */
async function queryKnowledgeBase(query: string, topK: number, serverId: string | null) {
  const doRetrieve = async () => {
    const config = await readConfig();

    // 1) Try running generated server first
    const server = await refreshServerStatus();
    if (server.running) {
      try {
        const start = Date.now();
        const res = await fetch(`${server.endpoint}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, topK }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json();

        const { trackUsageEvent } = await import('@larkup/core/analytics-store');
        void trackUsageEvent({
          type: 'server_request',
          endpoint: '/query',
          method: 'POST',
          statusCode: res.status,
          latencyMs: Date.now() - start,
          serverId: serverId ?? undefined,
          timestamp: new Date().toISOString(),
        });

        if (res.ok && data.hits) {
          return {
            query,
            hits: (data.hits as any[]).map((h: any) => ({
              title: h.title ?? 'Untitled',
              url: h.url ?? '',
              score: Number((h.score ?? 0).toFixed(3)),
              text: (h.text ?? '').slice(0, 1200),
            })),
          };
        }
      } catch {
        // Fall through to direct retrieval
      }
    }

    // 2) Direct retrieval from local vector store
    const run = await readRun();
    if (!run || run.status !== 'completed' || (run.totalChunks ?? 0) === 0) {
      return { query, hits: [] };
    }

    const vector = await embedQuery(config, query);
    const adapter = await createAdapter(config);
    const hits = await adapter.query(vector, topK, query);

    return {
      query,
      hits: hits.map((h) => ({
        title: h.title ?? 'Untitled',
        url: h.url ?? '',
        score: Number((h.score ?? 0).toFixed(3)),
        text: (h.text ?? '').slice(0, 1200),
      })),
    };
  };

  return serverId ? runWithServer(serverId, doRetrieve) : doRetrieve();
}

export async function POST(req: Request) {
  const {
    messages,
    serverId,
    chatModelId: requestedModelId,
  }: {
    messages: UIMessage[];
    serverId?: string;
    chatModelId?: string;
  } = await req.json();

  const config = await readConfig();
  const provider = config.chatProvider || config.embeddingProvider;

  // Fetch dynamic models to resolve defaults
  const gatewayModels = await getModelsByType('language');
  const allChatModels = gatewayModels.map(toChatDescriptor);

  const chatModelId =
    requestedModelId ||
    config.chatModelId ||
    getDefaultChatModel(allChatModels, provider)?.id ||
    'openai/gpt-4o-mini';

  const modelProvider = chatModelId.split('/')[0];
  const resolvedProvider =
    provider === 'vercel_ai_gateway' ? 'vercel_ai_gateway' : modelProvider || provider;

  const apiKey = config.chatApiKey || config.embeddingApiKey || undefined;
  console.log(
    'Using API Key for chat:',
    apiKey ? `${apiKey.substring(0, 10)}...` : 'NONE',
    'Provider:',
    resolvedProvider,
  );
  const model = createChatModel(
    resolvedProvider,
    chatModelId,
    apiKey,
    config.customChatModels,
  ) as any;

  let tabularContext = '';
  try {
    const datasets = await listTabularDatasets();
    if (datasets.length > 0) {
      tabularContext = `\n\nAvailable tabular datasets:\n${datasets
        .map((d) => {
          const colDescriptions = d.columns
            .map((c) => {
              let desc = `${c.name} (${c.type})`;
              if (c.type === 'date' && c.dateRange) {
                desc += ` [format: ${c.dateRange.format}, range: ${c.dateRange.min} to ${c.dateRange.max}]`;
              }
              // Add sample values for reference
              if (c.sampleValues && c.sampleValues.length > 0) {
                desc += ` [samples: ${c.sampleValues.slice(0, 3).join(', ')}]`;
              }
              return desc;
            })
            .join(', ');
          const sizeHint =
            d.rowCount > 10000
              ? ' ⚠️ LARGE DATASET — prefer executeAnalysis with pandas for complex queries'
              : '';
          return `- Dataset "${d.fileName}" (ID: ${d.id}): ${d.rowCount} rows, ${d.summary.totalColumns} columns.${sizeHint}\n  Columns: ${colDescriptions}`;
        })
        .join('\n')}`;
    }
  } catch {
    /* no tabular data */
  }

  const systemPrompt = (config.systemPrompt || DEFAULT_SYSTEM_PROMPT) + tabularContext;

  const result = streamText({
    model,
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(8),
    onFinish: async ({ usage, response }) => {
      const { trackUsageEvent, estimateCost } = await import('@larkup/core/analytics-store');
      const u = usage as any;
      void trackUsageEvent({
        type: 'chat',
        modelId: chatModelId,
        provider: resolvedProvider,
        promptTokens: u?.promptTokens ?? 0,
        completionTokens: u?.completionTokens ?? 0,
        totalTokens: u?.totalTokens ?? 0,
        estimatedCost: estimateCost(chatModelId, u?.promptTokens ?? 0, u?.completionTokens ?? 0),
        timestamp: new Date().toISOString(),
      });
    },
    tools: {
      searchKnowledgeBase: tool({
        description:
          'Search the private RAG knowledge base for relevant documents. Use this for factual questions about the indexed content.',
        inputSchema: z.object({
          query: z.string().describe('The search query for the knowledge base.'),
        }),
        execute: async ({ query }) => {
          return queryKnowledgeBase(query, 5, serverId ?? null);
        },
      }),

      queryTabularData: tool({
        description:
          'Query a tabular dataset (CSV/Excel/JSON) for exact values, filtering, grouping, and aggregations. Use this when the user asks about specific data values, comparisons, averages, sums, counts, highest/lowest, or any numerical question about uploaded data.',
        inputSchema: z.object({
          datasetId: z
            .string()
            .describe(
              'The ID of the dataset to query. Get this from the available datasets list in the system prompt.',
            ),
          filters: z
            .array(
              z.object({
                column: z.string(),
                op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']),
                value: z.any(),
              }),
            )
            .optional()
            .describe('Filters to apply to the data.'),
          groupBy: z.array(z.string()).optional().describe('Columns to group by for aggregations.'),
          aggregations: z
            .array(
              z.object({
                column: z.string(),
                op: z.enum(['sum', 'avg', 'count', 'min', 'max', 'median']),
              }),
            )
            .optional()
            .describe('Aggregation operations to perform.'),
          sortBy: z.string().optional().describe('Column to sort results by.'),
          sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction.'),
          limit: z.number().optional().describe('Max number of rows to return.'),
          columns: z
            .array(z.string())
            .optional()
            .describe('Specific columns to include in results.'),
        }),
        execute: async (params) => {
          try {
            return await queryTabular(params);
          } catch (err: any) {
            return {
              columns: [],
              rows: [],
              totalRows: 0,
              error: err.message ?? 'Query failed',
            };
          }
        },
      }),

      generateVisualization: tool({
        description:
          'Generate an interactive chart visualization. Use this when the user asks to see trends, comparisons, distributions, or any visual representation of data. The UI will render this as an interactive Recharts chart.',
        inputSchema: z.object({
          chartType: z
            .enum(['bar', 'area', 'line', 'pie', 'scatter', 'radar'])
            .describe('The type of chart to create.'),
          title: z.string().describe('Chart title.'),
          subtitle: z.string().optional().describe('Chart subtitle for additional context.'),
          data: z
            .array(z.record(z.string(), z.any()))
            .describe(
              "Array of data points to plot. You MUST provide the data here. Example: [{'name': 'North', 'value': 3206}, {'name': 'East', 'value': 2492}]",
            ),
          xAxisKey: z
            .string()
            .describe("The key in data objects to use for the X axis (usually 'name')."),
          series: z
            .array(
              z.object({
                dataKey: z.string().describe('The key in data objects for this series values.'),
                label: z
                  .string()
                  .optional()
                  .describe('Display label for this series in the legend.'),
                color: z
                  .string()
                  .optional()
                  .describe('Color for this series (hex). If omitted, theme colors are used.'),
              }),
            )
            .describe('Data series to plot.'),
          stacked: z.boolean().optional().describe('Whether to stack bar/area charts.'),
          showLegend: z.boolean().optional().default(true).describe('Whether to show the legend.'),
          xAxisLabel: z.string().optional().describe('Label for the X axis.'),
          yAxisLabel: z.string().optional().describe('Label for the Y axis.'),
        }),
        execute: async (config) => {
          // Pass through — the UI renders this directly
          return config;
        },
      }),

      executeAnalysis: tool({
        description:
          'Execute Python code in a secure sandbox for deep data analysis. Use this for complex statistical computations (correlations, regressions, clustering), data transformations, or when creating custom matplotlib visualizations. The code has access to pandas, numpy, matplotlib, scipy, scikit-learn, and seaborn. Always print results to stdout and use plt.show() for charts.',
        inputSchema: z.object({
          code: z
            .string()
            .describe(
              'Python code to execute. Has pandas, numpy, matplotlib, scipy, sklearn, seaborn available. Print results and use plt.show() for charts.',
            ),
          datasetId: z
            .string()
            .optional()
            .describe(
              "If provided, the dataset CSV will be available as 'data.csv' in the working directory.",
            ),
        }),
        execute: async ({ code, datasetId }) => {
          try {
            const sandboxManager = new SandboxManager({ backend: 'docker' });
            const files: { name: string; content: string }[] = [];

            if (datasetId) {
              const dataset = await getTabularDataset(datasetId);
              if (dataset && dataset.rows.length > 0) {
                const cols = dataset.columns.map((c) => c.name);
                const csvLines = [cols.join(',')];
                for (const row of dataset.rows) {
                  csvLines.push(
                    cols
                      .map((c) => {
                        const v = row[c];
                        const s = String(v ?? '');
                        return s.includes(',') || s.includes('"')
                          ? `"${s.replace(/"/g, '""')}"`
                          : s;
                      })
                      .join(','),
                  );
                }
                files.push({
                  name: 'data.csv',
                  content: csvLines.join('\n'),
                });
              }
            }

            const result = await sandboxManager.execute({
              code,
              language: 'python',
              files,
              timeout: 30_000,
            });

            return {
              stdout: result.stdout.slice(0, 5000),
              stderr: result.stderr.slice(0, 2000),
              exitCode: result.exitCode,
              artifacts: result.artifacts.map((a) => ({
                name: a.name,
                mimeType: a.mimeType,
                data: a.data.slice(0, 500_000), // cap at ~375KB base64
              })),
              executionTimeMs: result.executionTimeMs,
            };
          } catch (err: any) {
            return {
              stdout: '',
              stderr: err.message ?? 'Sandbox execution failed',
              exitCode: 1,
              artifacts: [],
              executionTimeMs: 0,
            };
          }
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error('[chat] stream error:', error);
      const message = error instanceof Error ? error.message : String(error);
      return message || 'Something went wrong while generating a response.';
    },
  });
}
