import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import { toChatDescriptor, getDefaultChatModel } from '@larkup/core/chat-models/registry';
import { listTabularDatasets } from '@larkup/core/tabular-store';

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { CustomModelConfig } from '@larkup/core/types';

import { getChatTools } from './tools';

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
- CRITICAL: You MUST populate the 'data' array in the 'generateVisualization' tool call with the exact rows of data you want to plot. Do NOT leave it empty.
- You CANNOT generate a chart from thin air. ALWAYS get the data FIRST (via getIndexedData, queryTabularData, or analyzeCorpusWithCode), THEN call generateVisualization with that actual data.
- The UI renders generateVisualization output as an interactive Recharts chart.

CRITICAL RULES FOR IMAGES AND KNOWLEDGE BASE:
- When a tool (like searchKnowledgeBase) returns document metadata containing images (e.g., 'metadata.images' with 'imageUrl'), you MUST display the image to the user in your response using standard Markdown syntax: '![Image Description](imageUrl)'. Do not just describe the image; show it!
- The image description in the search results is only a brief, high-level summary.
- If the user asks a detailed or structural question about an image (e.g., "what columns are in the film table in the diagram?", "how many items are listed?"), you MUST use the "analyzeImageDeeply" tool. Pass the 'imageUrl' and a detailed prompt to get the exact information you need directly from the image before answering.
- Do not hallucinate or guess details about images. If the high-level summary doesn't contain the answer, use analyzeImageDeeply.

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

LARGE DATASET HANDLING & PYTHON CODING RULES:
- For datasets with MORE than 10,000 rows, prefer "executeAnalysis" or "analyzeCorpusWithCode" with pandas.
- For simple lookups, counts, or single aggregations, queryTabularData or getIndexedData is fine.
- When using executeAnalysis, the tabular dataset is available as 'data.csv'. Use: df = pd.read_csv('data.csv')
- When using analyzeCorpusWithCode, the corpus is available as 'corpus.csv'. Use: df = pd.read_csv('corpus.csv')
- CRITICAL PANDAS RULES (Pandas 2.0+ is used):
  1. NEVER use deprecated frequency strings like "M", "Q", "Y" in resample() or pd.Grouper(). You MUST use "ME", "QE", "YE".
  2. NEVER use df.append() or series.append(). It was removed in pandas 2.0. You MUST use pd.concat([df1, df2]).
  3. Avoid using inplace=True on operations that no longer support it.
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
    tools: await getChatTools({ serverId, docSessionId, config }),
  });

  return result.toUIMessageStreamResponse({
    onError: (error: any) => {
      console.error('[chat] stream error:', error);
      if (error && typeof error === 'object') {
        if (error.message) {
          return error.message;
        }
        if (error.error && error.error.message) {
          return error.error.message;
        }
        try {
          return JSON.stringify(error);
        } catch {
          return 'Something went wrong while generating a response.';
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return message || 'Something went wrong while generating a response.';
    },
  });
}
