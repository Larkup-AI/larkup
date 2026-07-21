import { tool } from 'ai';
import { z } from 'zod';
import { readConfig } from '@larkup/core/config-store';
import { readRun } from '@larkup/core/index-store';
import { refreshServerStatus } from '@larkup/core/generator/server-runtime';
import { createAdapter } from '@larkup/vector-stores/factory';
import { embedQuery } from '@larkup/core/indexing/embedder';
import { runWithServer } from '@larkup/core/workspace';
import { getTabularDataset, queryTabular } from '@larkup/core/tabular-store';
import {
  getCorpusDocuments,
  exportCorpusAsCSV,
  exportCorpusAsJSONL,
  type CorpusFilter,
} from '@larkup/core/corpus-retriever';
import { SandboxManager } from '@larkup/sandbox';
import { applyFieldEdits, applyContentEdits } from '@larkup/tool-doc-editor';
import { loadTool } from '@larkup/marketplace/loader';
import { getInstalledTools } from '@larkup/marketplace/installer';

/**
 * Retrieves documents from the knowledge base
 */
export async function queryKnowledgeBase(query: string, topK: number, serverId: string | null) {
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
              metadata: h.metadata,
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
        metadata: h.metadata,
      })),
    };
  };

  return serverId ? runWithServer(serverId, doRetrieve) : doRetrieve();
}

export async function getChatTools(context: {
  serverId?: string;
  docSessionId?: string;
  config?: any;
}) {
  const { serverId, docSessionId, config } = context;

  const builtInTools: Record<string, any> = {
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
        columns: z.array(z.string()).optional().describe('Specific columns to include in results.'),
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
              label: z.string().optional().describe('Display label for this series in the legend.'),
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
            'Python code to execute. Has pandas (2.0+), numpy, matplotlib, scipy, sklearn, seaborn available. ALWAYS use "ME" instead of "M" for resample frequency. Print results and use plt.show() for charts.',
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
                      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
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

          let finalCode = code;
          let result = await sandboxManager.execute({
            code: finalCode,
            language: 'python',
            files,
            timeout: 30_000,
          });

          // Auto-retry once if code crashes
          if (result.exitCode !== 0) {
            // Apply regex patches for common LLM mistakes
            finalCode = finalCode.replace(/resample\((['"])M(['"])\)/g, 'resample($1ME$2)');
            finalCode = finalCode.replace(/resample\((['"])Q(['"])\)/g, 'resample($1QE$2)');
            finalCode = finalCode.replace(/resample\((['"])Y(['"])\)/g, 'resample($1YE$2)');
            finalCode = finalCode.replace(/freq=(['"])M(['"])/g, 'freq=$1ME$2');

            result = await sandboxManager.execute({
              code: finalCode,
              language: 'python',
              files,
              timeout: 30_000,
            });
          }

          return {
            stdout: result.stdout.slice(0, 5000),
            stderr: result.stderr.slice(0, 2000),
            exitCode: result.exitCode,
            artifacts: result.artifacts.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              data: a.data.slice(0, 500_000), // cap at around 375KB base64
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
            titleContains: z.string().optional().describe('Case-insensitive text search in title.'),
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
            'Python code to execute. The corpus file is in the working directory. Use pandas to load it: df = pd.read_csv("corpus.csv") or for JSONL: df = pd.read_json("corpus.jsonl", lines=True). Has pandas (2.0+), numpy, matplotlib, scipy, sklearn, seaborn available. ALWAYS use "ME" instead of "M" for resample frequency. Print results and use plt.show() for charts.',
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

          let finalCode = code;
          let result = await sandboxManager.execute({
            code: finalCode,
            language: 'python',
            files,
            timeout: 30_000,
          });

          // Auto-retry once if code crashes
          if (result.exitCode !== 0) {
            // Apply regex patches for common LLM mistakes
            finalCode = finalCode.replace(/resample\((['"])M(['"])\)/g, 'resample($1ME$2)');
            finalCode = finalCode.replace(/resample\((['"])Q(['"])\)/g, 'resample($1QE$2)');
            finalCode = finalCode.replace(/resample\((['"])Y(['"])\)/g, 'resample($1YE$2)');
            finalCode = finalCode.replace(/freq=(['"])M(['"])/g, 'freq=$1ME$2');

            result = await sandboxManager.execute({
              code: finalCode,
              language: 'python',
              files,
              timeout: 30_000,
            });
          }

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

    requestDocumentSignature: tool({
      description:
        'Use this when the user asks to sign the currently active document. You should analyze the document to find the best place for a signature (e.g. searching for "Signature:" or "Sign Here"). Yield the UI for the user to confirm the placement and provide their signature.',
      inputSchema: z.object({
        detectedLocations: z
          .array(
            z.object({
              pageIndex: z
                .number()
                .describe('The page index (0-based) where the signature belongs'),
              context: z
                .string()
                .describe(
                  'The text context around the signature line, e.g. "Employee Signature: ____"',
                ),
            }),
          )
          .describe('The detected signature locations in the document.'),
      }),
      execute: async ({ detectedLocations }) => {
        if (!docSessionId) return { success: false, error: 'No active document session' };

        // We return the detected locations so the UI can render the configuration form.
        return {
          success: true,
          action: 'request_signature',
          sessionId: docSessionId,
          detectedLocations,
        };
      },
    }),
  };

  const enabledTools = config?.enabledTools || [];
  const finalTools: Record<string, any> = {};

  // If empty, default to all built-in tools (backwards compatibility)
  const isEnabled = (id: string) => enabledTools.length === 0 || enabledTools.includes(id);

  // 1. Add enabled built-in tools
  for (const [id, toolDef] of Object.entries(builtInTools)) {
    if (isEnabled(id)) {
      finalTools[id] = toolDef;
    }
  }

  // 2. Add enabled marketplace tools
  // We fetch installed tools to see which ones are available
  try {
    const installed = await getInstalledTools();
    for (const t of installed) {
      if (isEnabled(t.id)) {
        const mod = await loadTool(t.id);
        if (mod && mod.default) {
          finalTools[t.id] = mod.default(context);
        } else if (mod && mod.tool) {
          finalTools[t.id] = mod.tool(context);
        }
      }
    }
  } catch (err) {
    console.error('[marketplace] Failed to load marketplace tools for chat:', err);
  }

  return finalTools;
}
