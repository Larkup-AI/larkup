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
import {
  getCorpusDocuments,
  exportCorpusAsCSV,
  exportCorpusAsJSONL,
  type CorpusFilter,
} from '@larkup/core/corpus-retriever';
import { SandboxManager } from '@larkup/sandbox';
import { applyFieldEdits, applyContentEdits } from '@larkup/tool-doc-editor';

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

const DEFAULT_SYSTEM_PROMPT = `You are a powerful data analysis assistant with access to a knowledge base, corpus introspection tools, tabular data tools, and a code sandbox.

You have these tools:
1. "searchKnowledgeBase" — semantic search over the RAG knowledge base. Returns top-K most relevant document chunks.
2. "getIndexedData" — structured access to ALL indexed source documents. Returns document metadata (title, source, status, metadata fields, dates). Use for counting, listing, filtering, and overview questions.
3. "analyzeCorpusWithCode" — runs Python code in a sandbox with the FULL corpus available as a CSV/JSONL file. Use for complex analysis of hundreds/thousands of documents.
4. "queryTabularData" — queries stored tabular datasets (CSV/Excel/JSON) for exact values, aggregations, filtering, and grouping.
5. "generateVisualization" — generates interactive charts to visualize data trends.
6. "executeAnalysis" — runs Python code in a sandbox for deep statistical analysis on tabular datasets.

TOOL SELECTION STRATEGY (follow this decision tree):
1. Greeting or general question → respond directly, no tools needed.
2. "Find me info about X", "What does Y say about Z?" → searchKnowledgeBase (semantic search, top-K).
3. "How many documents?", "List all X", "Show progress", "What's the status?", "Show me documents by source" → getIndexedData (structured data access with filters).
4. Complex analysis over hundreds of documents, pivot tables, grouping, pattern detection, progress tracking across many items → analyzeCorpusWithCode (Python sandbox with full corpus).
5. Questions about uploaded CSV/Excel/JSON data → queryTabularData.
6. Chart or visual representation needed → generateVisualization.
7. Complex statistical analysis on tabular data → executeAnalysis.

IMPORTANT — getIndexedData vs analyzeCorpusWithCode:
- Use getIndexedData for simple questions: counts, lists, filtering by source/status/metadata.
- Use analyzeCorpusWithCode when you need to PROCESS the actual content: parse fields from text, group by patterns, compute progress percentages, detect duplicates, or analyze metadata programmatically.
- analyzeCorpusWithCode gives you the corpus as 'corpus.csv' with columns: id, title, source, url, charCount, status, createdAt, content, plus any metadata_* columns.
- Example: "Show todo progress" → analyzeCorpusWithCode to parse status from content/metadata, compute percentages.
- Example: "How many docs are scraped?" → getIndexedData with source filter (simpler).

CRITICAL RULES FOR CHARTS AND VISUALIZATIONS:
- You MUST ALWAYS use the "generateVisualization" tool to display ANY visual data, trends, or charts.
- The UI strictly requires the "generateVisualization" tool to render interactive charts. Text-based approximations will not work.
- DO NOT be lazy. You MUST populate the 'data' array in the 'generateVisualization' tool call with the exact rows of data you want to plot.
- ALWAYS get the data FIRST (via getIndexedData, queryTabularData, or analyzeCorpusWithCode), THEN call generateVisualization with that data.
- The UI renders generateVisualization output as an interactive Recharts chart.

RESPONSE FORMATTING (Analytics Style):
- Structure your responses for an analytics dashboard — be concise and insight-driven.
- Lead with the key insight or answer in bold (e.g., "**October had the highest revenue at $487,384**").
- Use "### Key Findings" or "### Summary" headers to organize sections.
- For observations, use bullet points with bold labels: "- **Peak:** October at $487K"
- When presenting multiple numbers, prefer a table or call generateVisualization — do NOT list raw numbers line by line.
- End with 1-2 brief, actionable follow-up suggestions.
- Keep text SHORT. Let the charts and tables do the heavy lifting.
- NEVER output long lists of numbers as plain text. Use tables or charts instead.

DATE HANDLING:
- Date columns store values as strings. When filtering dates, use the EXACT format shown in the column metadata.
- For date comparisons, use "gt", "gte", "lt", "lte" operators with date strings in the same format as stored.
- NEVER convert dates to numbers. Always pass date filter values as strings matching the stored format.

LARGE DATASET HANDLING:
- For datasets with MORE than 10,000 rows, prefer "executeAnalysis" or "analyzeCorpusWithCode" with pandas.
- For simple lookups, counts, or single aggregations, queryTabularData or getIndexedData is fine.
- When using executeAnalysis, the tabular dataset is available as 'data.csv'. Use: df = pd.read_csv('data.csv')
- When using analyzeCorpusWithCode, the corpus is available as 'corpus.csv'. Use: df = pd.read_csv('corpus.csv')
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
    docSessionId,
    docFields,
  }: {
    messages: UIMessage[];
    serverId?: string;
    chatModelId?: string;
    docSessionId?: string;
    docFields?: { id: string; name: string; type: string }[];
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

  let docContext = '';
  if (docSessionId) {
    docContext = `\n\n[Active Document Session: ${docSessionId}]\nYou are currently editing a document in the Canvas.
The user may ask you to fill out form fields or edit content.
Use the "fillDocumentForm" or "editDocument" tools to apply changes.
Available Form Fields:
${docFields?.map((f) => `- [${f.id}] ${f.name} (${f.type})`).join('\n') || 'None detected.'}`;
  }

  const systemPrompt = (config.systemPrompt || DEFAULT_SYSTEM_PROMPT) + tabularContext + docContext;

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

      getIndexedData: tool({
        description:
          'Get structured access to ALL indexed source documents. Use this for counting, listing, filtering, and overview questions about the knowledge base. Returns document metadata (title, source type, status, custom metadata fields, dates). Use this when the user asks "how many documents?", "list all X", "show progress", "what sources?", or any structural question about the corpus.',
        inputSchema: z.object({
          filter: z
            .object({
              source: z
                .enum(['paste', 'upload', 'scrape', 'tabular', 'media'])
                .optional()
                .describe('Filter by document source type.'),
              status: z
                .enum(['indexed', 'unindexed'])
                .optional()
                .describe('Filter by indexing status.'),
              metadataKey: z.string().optional().describe('Filter by metadata key existence.'),
              metadataValue: z
                .string()
                .optional()
                .describe('Filter by metadata key=value (requires metadataKey).'),
              titleContains: z
                .string()
                .optional()
                .describe('Case-insensitive text search in title.'),
              createdAfter: z
                .string()
                .optional()
                .describe('Only docs created on or after this ISO date.'),
              createdBefore: z
                .string()
                .optional()
                .describe('Only docs created on or before this ISO date.'),
            })
            .optional()
            .describe('Optional filters to narrow down documents.'),
          limit: z
            .number()
            .optional()
            .default(200)
            .describe('Max number of document summaries to return (default 200).'),
          offset: z.number().optional().default(0).describe('Pagination offset.'),
          includeContent: z
            .boolean()
            .optional()
            .default(false)
            .describe(
              'Whether to include truncated document content. Default false for performance. Set true only when you need the actual text.',
            ),
        }),
        execute: async ({ filter, limit, offset, includeContent }) => {
          try {
            return await getCorpusDocuments(
              filter as CorpusFilter | undefined,
              limit ?? 200,
              offset ?? 0,
              includeContent ?? false,
            );
          } catch (err: any) {
            return {
              documents: [],
              total: 0,
              summary: {
                totalDocuments: 0,
                bySource: {},
                byStatus: {},
                topMetadataKeys: [],
                totalCharacters: 0,
                dateRange: null,
              },
              error: err.message ?? 'Failed to retrieve corpus data',
            };
          }
        },
      }),

      analyzeCorpusWithCode: tool({
        description:
          'Run Python code in a sandbox with the FULL indexed corpus available as a file. Use this for complex analysis of documents: parsing fields from content, computing progress percentages, grouping by patterns, detecting duplicates, generating charts from corpus data, or any question that requires programmatic processing of hundreds/thousands of documents. The corpus is available as "corpus.csv" (or "corpus.jsonl" if format is jsonl). CSV columns: id, title, source, url, charCount, status, createdAt, content, plus any metadata_* columns.',
        inputSchema: z.object({
          code: z
            .string()
            .describe(
              'Python code to execute. The corpus file is in the working directory. Use pandas to load it: df = pd.read_csv("corpus.csv") or for JSONL: df = pd.read_json("corpus.jsonl", lines=True). Has pandas, numpy, matplotlib, scipy, sklearn, seaborn available. Print results and use plt.show() for charts.',
            ),
          format: z
            .enum(['csv', 'jsonl'])
            .optional()
            .default('csv')
            .describe('Format of the corpus file. Default is CSV.'),
        }),
        execute: async ({ code, format }) => {
          try {
            const sandboxManager = new SandboxManager({ backend: 'docker' });

            // Export corpus in the requested format
            const corpusData =
              format === 'jsonl' ? await exportCorpusAsJSONL() : await exportCorpusAsCSV();

            if (!corpusData) {
              return {
                stdout: 'No documents found in the corpus.',
                stderr: '',
                exitCode: 0,
                artifacts: [],
                executionTimeMs: 0,
              };
            }

            const fileName = format === 'jsonl' ? 'corpus.jsonl' : 'corpus.csv';
            const files = [{ name: fileName, content: corpusData }];

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
                data: a.data.slice(0, 500_000),
              })),
              executionTimeMs: result.executionTimeMs,
            };
          } catch (err: any) {
            return {
              stdout: '',
              stderr: err.message ?? 'Corpus analysis failed',
              exitCode: 1,
              artifacts: [],
              executionTimeMs: 0,
            };
          }
        },
      }),

      fillDocumentForm: tool({
        description:
          'Fill form fields in the currently active document. You should use the searchKnowledgeBase tool to find answers to form questions if you do not know them. The available fields are provided in your system prompt.',
        inputSchema: z.object({
          edits: z
            .array(
              z.object({
                fieldId: z
                  .string()
                  .describe('The ID of the field to fill (from the active document context)'),
                value: z.string().describe('The value to set for the field'),
              }),
            )
            .describe('List of fields to fill and their new values'),
        }),
        execute: async ({ edits }) => {
          if (!docSessionId) return { success: false, error: 'No active document session' };

          try {
            const fieldEdits = edits.map((edit) => ({
              ...edit,
              type: 'fill' as const,
            }));
            const result = await applyFieldEdits(docSessionId, fieldEdits);
            if (!result.success) {
              return { success: false, error: result.error };
            }

            return {
              success: true,
              action: 'fill_document',
              sessionId: docSessionId,
              edits,
              updatedFields: result.updatedFields,
              fields: result.parsed.fields,
              pages: result.parsed.pages.map((p) => ({
                index: p.index,
                text: p.text.slice(0, 2000),
                html: p.html,
                fields: p.fields,
                dimensions: p.dimensions,
              })),
              totalPages: result.parsed.totalPages,
              fileBase64: result.fileBase64,
            };
          } catch (err: any) {
            return { success: false, error: err.message };
          }
        },
      }),

      editDocument: tool({
        description:
          'Edit the content (text) of the currently active document. Use this when the user asks to modify paragraphs or slides (not form fields).',
        inputSchema: z.object({
          edits: z
            .array(
              z.object({
                pageIndex: z.number().default(0).describe('Page or slide index (0-based)'),
                type: z.enum(['replace_text', 'insert_text']).describe('Type of edit'),
                search: z.string().optional().describe('Text to search for (if replacing)'),
                text: z.string().describe('Replacement text or text to insert'),
              }),
            )
            .describe('List of content edits to apply'),
        }),
        execute: async ({ edits }) => {
          if (!docSessionId) return { success: false, error: 'No active document session' };

          try {
            const result = await applyContentEdits(docSessionId, edits);
            if (!result.success) {
              return { success: false, error: result.error };
            }

            return {
              success: true,
              action: 'edit_document',
              sessionId: docSessionId,
              edits,
              updatedFields: result.updatedFields,
              pages: result.parsed.pages.map((p) => ({
                index: p.index,
                text: p.text.slice(0, 2000),
                html: p.html,
                fields: p.fields,
                dimensions: p.dimensions,
              })),
              totalPages: result.parsed.totalPages,
              fileBase64: result.fileBase64,
            };
          } catch (err: any) {
            return { success: false, error: err.message };
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
