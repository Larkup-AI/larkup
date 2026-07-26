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
import { DEFAULT_SYSTEM_PROMPT } from '@larkup/core/types';

import { getChatTools } from './tools';

export const maxDuration = 60;

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

const SMART_RETRIEVAL_POLICY = `

CONVERSATION, RETRIEVAL, AND MEDIA POLICY:
- Default to a short, direct answer. One to three sentences is usually enough; use structure only when the task is genuinely complex.
- Do not search for greetings, casual conversation, writing help, brainstorming, explanations you can answer reliably from general knowledge, or questions unrelated to the user's indexed data.
- Use searchKnowledgeBase only when the answer depends on the user's indexed/private content, an exact source-specific fact, or a topic that plausibly refers to something the user indexed.
- Treat questions about the user or their materials as knowledge-base questions: phrases such as "I", "my", "our", "you have", "the database", "the document", "the file", or "the diagram" require searchKnowledgeBase before answering whenever indexed content may contain the answer.
- Search at most once per user request unless the first search is clearly irrelevant. Never repeat a search when a prior tool result in this conversation already contains enough evidence.
- For a follow-up such as "show me that part", "play the clip", "show the image", or "let me hear it", reuse the mediaAssetId and timestamps already present in the earlier search result and call presentMedia directly. Do not search again just to rediscover the same media.
- Use presentMedia to embed exactly one best video, image, or audio citation when the user asks to see/hear it or when one compact preview materially supports the answer. Do not present every search result.
- Keep the written answer minimal around a media citation. Do not print internal media reference markers.
`;

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
    docFields?: {
      id: string;
      name: string;
      type: string;
      value?: string;
      context?: string;
      placeholder?: string;
    }[];
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
  const model = createChatModel(
    resolvedProvider,
    chatModelId,
    apiKey,
    config.customChatModels,
  ) as any;

  // Strip large PDF base64 attachments and heavy doc-tool results from messages to prevent context window explosion.
  // Also limit message history to last 20 messages to prevent unbounded growth.
  const MAX_HISTORY_MESSAGES = 20;
  const messagesToProcess =
    messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
      : messages;

  const safeMessages = messagesToProcess.map((m) => {
    const anyM = { ...m } as any;

    // Helper: strip heavy keys from a tool result object
    const stripHeavyResult = (result: any, toolName?: string): any => {
      let resultObj = result;
      let isString = false;
      if (typeof result === 'string') {
        try {
          resultObj = JSON.parse(result);
          isString = true;
        } catch {
          return result;
        }
      }
      if (typeof resultObj !== 'object' || resultObj === null) return result;
      const isDocTool =
        toolName &&
        ['fillDocumentForm', 'editDocument', 'requestDocumentSignature'].includes(toolName);
      if (isDocTool || resultObj.fileBase64 || resultObj.pages) {
        const copy = { ...resultObj };
        delete copy.fileBase64;
        delete copy.pages;
        if (isDocTool) {
          delete copy.fields;
          if (copy.rawText) copy.rawText = copy.rawText.slice(0, 500);
        }
        return isString ? JSON.stringify(copy) : copy;
      }
      return result;
    };

    // Clean toolInvocations on historical messages — strip fileBase64, pages, and heavy field arrays
    if (anyM.role === 'assistant' && anyM.toolInvocations) {
      anyM.toolInvocations = anyM.toolInvocations
        .filter(
          (ti: any) =>
            ti.state === 'result' || ti.state === 'output' || ti.state === 'output-available',
        )
        .map((ti: any) => {
          if (ti.result) {
            return { ...ti, result: stripHeavyResult(ti.result, ti.toolName) };
          }
          return ti;
        });
    }

    // Clean parts (AI SDK v5 UIMessage format) — strip heavy data from tool results and file parts
    if (Array.isArray(anyM.parts)) {
      anyM.parts = anyM.parts.map((part: any) => {
        // Tool invocation parts — strip heavy results
        if (part.type === 'tool-invocation' && part.toolInvocation) {
          const ti = part.toolInvocation;
          if (ti.result !== undefined) {
            return {
              ...part,
              toolInvocation: {
                ...ti,
                result: stripHeavyResult(ti.result, ti.toolName),
              },
            };
          }
        }
        // New-format tool parts (tool-result)
        if (part.type === 'tool-result' && part.result !== undefined) {
          return { ...part, result: stripHeavyResult(part.result, part.toolName) };
        }
        // File parts — strip large non-image files (PDF base64)
        if (part.type === 'file') {
          const data = part.data || part.url || '';
          if (typeof data === 'string' && data.length > 5000) {
            const mimeType = (part.mimeType || part.mediaType || '').toLowerCase();
            const isImage = mimeType.startsWith('image/');
            if (!isImage) {
              // Replace with a placeholder
              return {
                type: 'text',
                text: `[File attachment: ${
                  mimeType || 'document'
                } — removed from context for size]`,
              };
            }
          }
        }
        return part;
      });
    }

    // Strip PDF attachments from experimental_attachments (base64 data URLs can be many MB)
    if (anyM.experimental_attachments) {
      anyM.experimental_attachments = anyM.experimental_attachments.filter((att: any) => {
        if (att.url && att.url.length > 5000) {
          const isPdf =
            (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
            (att.name && att.name.toLowerCase().endsWith('.pdf')) ||
            att.url.substring(0, 50).toLowerCase().includes('pdf');

          if (isPdf || !(att.contentType && att.contentType.toLowerCase().startsWith('image/'))) {
            return false;
          }
        }
        return true;
      });
    }

    if (Array.isArray(anyM.content)) {
      anyM.content = anyM.content.filter((part: any) => {
        const data = part.data || part.url || part.text;
        if (typeof data === 'string' && data.length > 5000) {
          const isPdf =
            (part.mimeType && part.mimeType.toLowerCase().includes('pdf')) ||
            (part.contentType && part.contentType.toLowerCase().includes('pdf')) ||
            data.substring(0, 50).toLowerCase().includes('pdf');

          if (
            isPdf ||
            !(part.mimeType?.startsWith('image/') || part.contentType?.startsWith('image/'))
          ) {
            return false;
          }
        }
        return true;
      });
    }

    return anyM;
  });

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
    // Build a rich field listing so the LLM can correctly match semantic meaning to field IDs.
    // Include: ID, name/label, type, current value (if any), and surrounding context text.
    const fieldLines =
      docFields && docFields.length > 0
        ? (docFields as any[])
            .map((f: any) => {
              let line = `- ID: "${f.id}" | Label: "${f.name}" | Type: ${f.type}`;
              if (f.value) line += ` | Current value: "${f.value}"`;
              if (f.context) line += ` | Surrounding text: "${String(f.context).slice(0, 120)}"`;
              if (f.placeholder) line += ` | Placeholder: "${f.placeholder}"`;
              return line;
            })
            .join('\n')
        : 'None detected.';

    docContext = `\n\n[Active Document Session: ${docSessionId}]\nYou are currently editing a document in the Canvas.
The user may ask you to fill out form fields or edit content.
IMPORTANT: Use the exact field IDs listed below when calling "fillDocumentForm". Do NOT invent field IDs.
Available Form Fields (${docFields?.length ?? 0} total):
${fieldLines}`;
  }

  const systemPrompt =
    (config.systemPrompt || DEFAULT_SYSTEM_PROMPT) +
    SMART_RETRIEVAL_POLICY +
    tabularContext +
    docContext;
  const tools = await getChatTools({ serverId, docSessionId, config });

  // Debug: log payload sizes to console in development
  if (process.env.NODE_ENV === 'development') {
    const stringifiedMsgs = JSON.stringify(safeMessages);
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages: await convertToModelMessages(safeMessages, { tools }),
    maxOutputTokens: 8192,
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
    tools,
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
