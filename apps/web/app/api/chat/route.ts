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

TOOL RULES:
1. searchKnowledgeBase → Use FIRST when the question is about the user's indexed data (documents, files, images, videos, diagrams, anything they uploaded).
2. webSearch → Use ONLY after searchKnowledgeBase returned nothing relevant AND the question needs current/public facts.
3. Other tools → Use when the question specifically requires them.
4. General knowledge → Answer directly for common knowledge unrelated to the user's data.
5. If nothing helps, say so honestly.

DO:
- Keep answers short and direct. 1–3 sentences unless the task is complex.
- Search at most ONCE per tool per turn. Never repeat the same search.
- Use presentMedia to show images/videos/audio from indexed content.
- For follow-ups like "show me that", reuse the mediaAssetId from earlier results — do not search again.

DO NOT:
- Search for greetings, casual chat, writing help, or general knowledge you already know.
- Output markdown images like ![alt](url) — the UI blocks them. Always use presentMedia instead.
- Present every search result. Pick the single best one.
- Guess or fabricate when results are insufficient.
`;

function latestUserText(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'user') as any;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join(' ');
  }
  return '';
}

/** Only force KB search when the user explicitly refers to their own data.
 * Matches "my document", "our files", "the uploaded image" etc. but NOT
 * generic uses like "I want to know", "can you tell me", "I think". */
function requiresKnowledgeBaseSearch(text: string): boolean {
  // Skip generic conversational patterns
  if (/^(hi|hello|hey|thanks|thank you|ok|sure|yes|no|please|help)\b/i.test(text.trim())) {
    return false;
  }
  // Match possessive references to user data
  return (
    /\b(my|our)\s+(favo(?:u)?rite|preference|choice|answer|name|result|score|winner)\b/i.test(
      text,
    ) ||
    /\b(my|our)\s+(document|file|data|image|picture|diagram|video|audio|upload|corpus|knowledge|database|db|pdf|report|spreadsheet|presentation)/i.test(
      text,
    ) ||
    /\b(the|this|that)\s+(document|file|diagram|image|picture|upload|pdf|report)/i.test(text) ||
    /\b(uploaded?|indexed|scraped|knowledge base|corpus)\b/i.test(text) ||
    /\bshow\s+me\b/i.test(text)
  );
}

/** Questions whose answer is inherently time-sensitive should not rely on the
 * model's training snapshot when Web Search is available. */
function requiresCurrentWebSearch(text: string): boolean {
  return /\b(who won|winner|final score|match result|latest|current|today|yesterday|breaking news|weather|stock price|exchange rate|election result|schedule)\b/i.test(
    text,
  );
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
      // Keep previous retrieval evidence available for follow-up questions,
      // while preventing several full five-chunk search responses from taking
      // over the model context on a long conversation.
      if (toolName === 'searchKnowledgeBase' && Array.isArray(resultObj.hits)) {
        const compact = {
          ...resultObj,
          hits: resultObj.hits.map((hit: any) => ({
            documentId: hit.documentId,
            title: hit.title,
            url: hit.url,
            score: hit.score,
            text: typeof hit.text === 'string' ? hit.text.slice(0, 1_000) : hit.text,
            images: hit.images,
            metadata: hit.metadata,
            timelineContext: hit.timelineContext,
            endingContext: hit.endingContext,
          })),
        };
        return isString ? JSON.stringify(compact) : compact;
      }
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
    DEFAULT_SYSTEM_PROMPT +
    (config.systemPrompt && config.systemPrompt !== DEFAULT_SYSTEM_PROMPT
      ? `\n\nUSER INSTRUCTIONS:\n${config.systemPrompt}`
      : '') +
    SMART_RETRIEVAL_POLICY +
    (config.webSearchEnabled
      ? '\nWeb search is available. Use it for current events or public facts not in the knowledge base.\n'
      : '') +
    tabularContext +
    docContext;
  const tools = await getChatTools({ serverId, docSessionId, config });
  const userText = latestUserText(messagesToProcess);
  const forceKnowledgeBaseSearch =
    requiresKnowledgeBaseSearch(userText) && Boolean(tools.searchKnowledgeBase);
  const forceWebSearch =
    config.webSearchEnabled === true &&
    requiresCurrentWebSearch(userText) &&
    Boolean(tools.webSearch);

  // Debug: log payload sizes to console in development
  if (process.env.NODE_ENV === 'development') {
    const stringifiedMsgs = JSON.stringify(safeMessages);
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages: await convertToModelMessages(safeMessages, { tools }),
    maxOutputTokens: 4096,
    // Three steps: retrieve → optionally present media → answer.
    stopWhen: stepCountIs(3),
    toolChoice: 'auto',
    prepareStep: ({ stepNumber }) => {
      // Step 0: force KB search if needed
      if (forceKnowledgeBaseSearch && stepNumber === 0) {
        return { toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' } };
      }
      // For questions about the user's data, let the model evaluate the KB
      // result before falling back to the web. Forcing both tools used to make
      // enabled web search override a perfectly relevant local answer.
      if (forceWebSearch && !forceKnowledgeBaseSearch && stepNumber === 0) {
        return { toolChoice: { type: 'tool', toolName: 'webSearch' } };
      }
      // After a forced tool, and after the optional KB → web fallback, remove
      // search tools. This guarantees one concise search surface rather than
      // a chain of near-identical web queries.
      if (stepNumber >= 2) {
        return {
          activeTools: Object.keys(tools).filter(
            (name) => name !== 'webSearch' && name !== 'searchKnowledgeBase',
          ),
        };
      }
      if (forceKnowledgeBaseSearch && stepNumber >= 1) {
        return { activeTools: Object.keys(tools).filter((name) => name !== 'searchKnowledgeBase') };
      }
      if (forceWebSearch && stepNumber >= 1) {
        return { activeTools: Object.keys(tools).filter((name) => name !== 'webSearch') };
      }
      return undefined;
    },
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
