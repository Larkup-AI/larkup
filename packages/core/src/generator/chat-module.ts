import type { RagConfig } from '../types';

function providerSource(provider: string, customBaseUrl = '') {
  switch (provider) {
    case 'google':
      return `import { createGoogleGenerativeAI } from "@ai-sdk/google";
const provider = createGoogleGenerativeAI({ apiKey: CHAT_API_KEY });
const model = provider(MODEL_NAME);`;
    case 'cohere':
      return `import { createCohere } from "@ai-sdk/cohere";
const provider = createCohere({ apiKey: CHAT_API_KEY });
const model = provider(MODEL_NAME);`;
    case 'mistral':
      return `import { createMistral } from "@ai-sdk/mistral";
const provider = createMistral({ apiKey: CHAT_API_KEY });
const model = provider(MODEL_NAME);`;
    case 'deepseek':
      return `import { createDeepSeek } from "@ai-sdk/deepseek";
const provider = createDeepSeek({ apiKey: CHAT_API_KEY });
const model = provider(MODEL_NAME);`;
    case 'vercel_ai_gateway':
      return `import { createGateway } from "@ai-sdk/gateway";
const provider = createGateway({ apiKey: CHAT_API_KEY });
const model = provider(CHAT_MODEL);`;
    case 'custom':
      return `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
const provider = createOpenAICompatible({
  name: "larkup-custom",
  baseURL: process.env.CHAT_BASE_URL || ${JSON.stringify(customBaseUrl)},
  apiKey: CHAT_API_KEY,
});
const model = provider.chatModel(MODEL_NAME);`;
    default:
      return `import { createOpenAI } from "@ai-sdk/openai";
const provider = createOpenAI({ apiKey: CHAT_API_KEY });
const model = provider(MODEL_NAME);`;
  }
}

export function resolveChatProvider(config: RagConfig): string {
  if (config.chatProvider) return config.chatProvider;
  if (config.chatModelId?.startsWith('custom:')) return 'custom';
  const prefix = config.chatModelId?.split('/', 1)[0];
  if (prefix && ['openai', 'google', 'cohere', 'mistral', 'deepseek'].includes(prefix)) {
    return prefix;
  }
  return config.embeddingProvider || 'openai';
}

export function resolveChatModel(
  config: RagConfig,
  provider = resolveChatProvider(config),
): string {
  if (config.chatModelId) return config.chatModelId;
  if (provider === 'custom' && config.customChatModels?.[0]) {
    return `custom:${config.customChatModels[0].modelName}`;
  }
  const defaults: Record<string, string> = {
    openai: 'openai/gpt-4o-mini',
    google: 'google/gemini-2.5-flash',
    cohere: 'cohere/command-r-plus',
    mistral: 'mistral/mistral-large-latest',
    deepseek: 'deepseek/deepseek-chat',
    vercel_ai_gateway: 'openai/gpt-4o-mini',
  };
  return defaults[provider] || defaults.openai;
}

export function generateChatModule(config: RagConfig): string {
  const provider = resolveChatProvider(config);
  const chatModel = resolveChatModel(config, provider);
  const customName = chatModel.startsWith('custom:')
    ? chatModel.slice('custom:'.length)
    : chatModel;
  const customBaseUrl = (config.customChatModels ?? []).find(
    (model) => model.modelName === customName,
  )?.baseUrl;
  const resolvedProviderSource = providerSource(provider, customBaseUrl);
  const systemPrompt =
    config.systemPrompt || 'You are a helpful assistant grounded in the supplied knowledge base.';

  return `import { streamText } from "ai";
import { embedQuery } from "./embed.mjs";
import { query as storeQuery } from "./store.mjs";

const CHAT_API_KEY = process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || "";
const CHAT_MODEL = process.env.CHAT_MODEL || ${JSON.stringify(chatModel)};
const MODEL_NAME = CHAT_MODEL.startsWith("custom:")
  ? CHAT_MODEL.slice("custom:".length)
  : CHAT_MODEL.includes("/")
    ? CHAT_MODEL.split("/").slice(1).join("/")
    : CHAT_MODEL;
const SYSTEM_PROMPT = process.env.CHAT_SYSTEM_PROMPT || ${JSON.stringify(systemPrompt)};

${resolvedProviderSource}

function textFromMessage(message) {
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\\n")
      .trim();
  }
  return "";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleChat(req, res) {
  try {
    const body = await readBody(req);
    if (!Array.isArray(body.messages)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Body must include a messages array." }));
    }

    const messages = body.messages
      .filter((message) => ["user", "assistant", "system"].includes(message?.role))
      .map((message) => ({ role: message.role, content: textFromMessage(message) }))
      .filter((message) => message.content);
    const latestUser = [...messages].reverse().find((message) => message.role === "user");
    if (!latestUser) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "At least one user message is required." }));
    }

    const vector = await embedQuery(latestUser.content);
    const requestedTopK = Number(body.topK) || Number(process.env.TOP_K || 5);
    const hits = await storeQuery(vector, Math.min(50, Math.max(1, requestedTopK)));
    const context = hits
      .map((hit, index) => \`[\${index + 1}] \${hit.title || "Untitled"}\\n\${hit.text}\`)
      .join("\\n\\n");
    const requestedSystem = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\\n\\n");

    const system = [
      SYSTEM_PROMPT,
      requestedSystem,
      context
        ? \`Use the retrieved context below when it is relevant. If it does not answer the question, say so.\\n\\n\${context}\`
        : "",
    ].filter(Boolean).join("\\n\\n");
    const modelMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));
    const result = streamText({ model, system, messages: modelMessages });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    for await (const text of result.textStream) {
      res.write(\`event: message\\ndata: \${JSON.stringify({ type: "text-delta", text })}\\n\\n\`);
    }
    res.write(\`event: done\\ndata: \${JSON.stringify({ type: "done", hits })}\\n\\n\`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
      return;
    }
    res.write(\`event: error\\ndata: \${JSON.stringify({ type: "error", error: message })}\\n\\n\`);
    res.end();
  }
}
`;
}

export function addChatProviderDependency(
  dependencies: Record<string, string>,
  provider: string | undefined,
) {
  const packageByProvider: Record<string, string> = {
    custom: '@ai-sdk/openai-compatible',
    google: '@ai-sdk/google',
    cohere: '@ai-sdk/cohere',
    mistral: '@ai-sdk/mistral',
    deepseek: '@ai-sdk/deepseek',
    vercel_ai_gateway: '@ai-sdk/gateway',
    openai: '@ai-sdk/openai',
  };
  dependencies[packageByProvider[provider || 'openai'] || '@ai-sdk/openai'] = 'latest';
}
