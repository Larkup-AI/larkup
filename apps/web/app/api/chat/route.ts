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
import {
  requiresCurrentWebSearch,
  requiresKnowledgeBaseSearch,
  retrievalToolsForStep,
} from '@/lib/retrieval-routing';
import { gatewayProviderOptions } from '@/lib/gateway-fallbacks';

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
1. searchKnowledgeBase → Use FIRST when the question is about the user's indexed data (documents, files, images, videos, diagrams, anything they uploaded). A question about who won a named match or its score may refer to an indexed recording even when the user does not repeat "my video"; inspect the knowledge base first.
2. webSearch → Use for clearly current/public facts. If a prior local search was not relevant or failed, use it as the one permitted fallback. If web search fails, use the knowledge base as the one permitted fallback.
3. Other tools → Use when the question specifically requires them.
4. General knowledge → Answer directly for common knowledge unrelated to the user's data.
5. If nothing helps, say so honestly.

DO:
- Keep answers short and direct. 1–3 sentences unless the task is complex.
- Make answers presentation-ready: use a natural lead sentence and clean bullets for lists. Use descriptive headings only when they add clarity; never expose raw-looking headings such as "#### View Names:".
- Search at most ONCE per tool per turn. Never repeat the same search.
- For questions about the user's own facts or preferences (for example, "what is my favourite fruit?"), searchKnowledgeBase is required before answering.
- If a knowledge-base result contains PDF images and the question asks what is shown, named, counted, or connected in that visual, call analyzeImageDeeply before answering. Call presentMedia when the user asks to see the image.
- For an indexed video outcome question, inspect endingContext before saying that a winner or final score is unavailable. Use only explicitly supported evidence.
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
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
    ? message.content
    : [];
  if (parts.length) {
    return parts
      .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join(' ');
  }
  return '';
}

function normalizedQuestion(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** An exact repeated question in the same conversation already has grounded
 * evidence in model context. Do not spend another embedding + vector query;
 * the previous tool result remains available in the compacted history. */
function hasPriorKnowledgeBaseAnswer(messages: UIMessage[], question: string): boolean {
  const target = normalizedQuestion(question);
  if (!target) return false;

  for (let index = 0; index < messages.length - 1; index++) {
    if (
      messages[index].role !== 'user' ||
      normalizedQuestion(latestUserText([messages[index]])) !== target
    ) {
      continue;
    }
    for (let cursor = index + 1; cursor < messages.length; cursor++) {
      const message = messages[cursor] as any;
      if (message.role === 'user') break;
      const toolCalls = [
        ...(Array.isArray(message.toolInvocations) ? message.toolInvocations : []),
        ...(Array.isArray(message.parts)
          ? message.parts.map((part: any) => part.toolInvocation ?? part)
          : []),
      ];
      if (
        toolCalls.some((call: any) => {
          const result = call?.result ?? call?.output;
          return (
            call?.toolName === 'searchKnowledgeBase' &&
            Array.isArray(result?.hits) &&
            result.hits.length > 0
          );
        })
      ) {
        return true;
      }
    }
  }
  return false;
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
  const tools = await getChatTools({
    serverId,
    docSessionId,
    config,
    origin: new URL(req.url).origin,
  });
  const userText = latestUserText(messagesToProcess);
  const forceKnowledgeBaseSearch =
    requiresKnowledgeBaseSearch(userText) &&
    !hasPriorKnowledgeBaseAnswer(messagesToProcess, userText) &&
    Boolean(tools.searchKnowledgeBase);
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
    // The Gateway owns model failover. Retrying the same quota-limited model
    // only makes the user wait longer and consumes their request allowance.
    maxRetries: 0,
    providerOptions: gatewayProviderOptions(resolvedProvider, chatModelId),
    system: systemPrompt,
    messages: await convertToModelMessages(safeMessages, { tools }),
    maxOutputTokens: 4096,
    // Three steps: retrieve → optionally inspect/present media → answer.
    stopWhen: stepCountIs(3),
    toolChoice: 'auto',
    prepareStep: ({ stepNumber }) =>
      retrievalToolsForStep({
        stepNumber,
        forceKnowledgeBaseSearch,
        forceWebSearch: forceWebSearch && !forceKnowledgeBaseSearch,
        toolNames: Object.keys(tools),
      }),
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
    sendReasoning: true,
    onError: (error: any) => {
      // Extract the deepest error message available
      const rawMessage: string =
        error?.lastError?.message ||
        error?.message ||
        error?.error?.message ||
        (typeof error === 'string' ? error : '');

      // Only log non-trivial errors to console (skip tool-routing noise)
      const isToolRouting =
        rawMessage.includes('unavailable tool') || error?.name === 'AI_NoSuchToolError';
      if (!isToolRouting) {
        console.error('[chat] stream error:', rawMessage);
      }

      // ── Rate limit / quota exceeded ──
      if (
        rawMessage.includes('rate-limited') ||
        rawMessage.includes('rate_limit') ||
        rawMessage.includes('RateLimitError') ||
        rawMessage.includes('429') ||
        rawMessage.includes('quota')
      ) {
        return 'Vercel AI Gateway could not serve this model because it is rate-limited. We tried compatible backup models. Try again shortly, choose another model, or add AI Gateway credits / a provider key in Settings.';
      }

      // ── Model tried to call a tool that was not available in this step ──
      // This happens when the step-routing removes a tool but the model still
      // tries to call it. It is not a real failure — just retry.
      if (isToolRouting) {
        return 'The model tried an unavailable action. Please try your question again.';
      }

      // ── Authentication / API key errors ──
      if (
        rawMessage.includes('401') ||
        rawMessage.includes('Unauthorized') ||
        rawMessage.includes('Invalid API Key') ||
        rawMessage.includes('authentication')
      ) {
        return 'Your API key appears to be invalid or expired. Please check your AI provider settings.';
      }

      // ── Context length / token limit ──
      if (
        rawMessage.includes('context_length') ||
        rawMessage.includes('maximum context') ||
        rawMessage.includes('too many tokens') ||
        rawMessage.includes('max_tokens')
      ) {
        return 'The conversation is too long for this model. Try starting a new chat or switching to a model with a larger context window.';
      }

      // ── Timeout ──
      if (rawMessage.includes('timeout') || rawMessage.includes('ETIMEDOUT')) {
        return 'The request timed out. Please try again.';
      }

      // ── Generic fallback — strip any URLs and technical noise ──
      if (rawMessage.length > 200 || rawMessage.includes('http')) {
        return 'Something went wrong while generating a response. Please try again.';
      }

      return rawMessage || 'Something went wrong while generating a response.';
    },
  });
}
