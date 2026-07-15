import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { readConfig } from "@larkup/core/config-store";
import { readRun } from "@larkup/core/index-store";
import { refreshServerStatus } from "@larkup/core/generator/server-runtime";
import { createAdapter } from "@larkup/vector-stores/factory";
import { embedQuery } from "@larkup/core/indexing/embedder";
import { runWithServer } from "@larkup/core/workspace";
import { getModelsByType } from "@larkup/core/models-cache";
import { toChatDescriptor, getDefaultChatModel } from "@larkup/core/chat-models/registry";

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createCohere } from "@ai-sdk/cohere";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CustomModelConfig } from "@larkup/core/types";

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful research assistant powered by a knowledge base.

You have one tool:
- "searchKnowledgeBase" — searches a private RAG knowledge base.

Guidelines:
- ONLY skip the tool if the user's message is a basic greeting (e.g., "hi", "hello") or simple conversational filler.
- For ALL OTHER messages (especially questions about facts, personal preferences, instructions, or specific topics), you MUST call the searchKnowledgeBase tool FIRST before answering. Do not assume you cannot answer a question (like "what do I like?") without checking the knowledge base first!
- Synthesize a clear, well-structured answer based on the retrieved documents.
- Cite sources inline using markdown links to their URLs when available.
- Be concise and accurate. Never fabricate sources or facts.
- Don't reply to the user with a question — try to give the answer unless you truly need clarification.
- IMPORTANT: If the searchKnowledgeBase tool returns empty results, inform the user that you currently have no knowledge in your database for their specific question. However, you may still attempt to answer general questions using your general knowledge.
`;

/**
 * Creates an AI SDK language model instance based on the provider and model ID.
 */
function createChatModel(provider: string, modelId: string, apiKey?: string, customChatModels?: CustomModelConfig[]) {
  if (modelId.startsWith("custom:")) {
    const customName = modelId.slice("custom:".length);
    const custom = (customChatModels ?? []).find(
      (m) => m.modelName === customName,
    );
    if (custom) {
      const customProvider = createOpenAICompatible({
        name: "custom_chat_provider",
        baseURL: custom.baseUrl,
        apiKey: custom.apiKey || apiKey || undefined,
      });
      return customProvider(custom.modelName);
    }
  }

  const modelName = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;

  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case "cohere":
      return createCohere({ apiKey })(modelName);
    case "mistral":
      return createMistral({ apiKey })(modelName);
    case "deepseek":
      return createDeepSeek({ apiKey })(modelName);
    case "anthropic":
      return createAnthropic({ apiKey })(modelName);
    case "openai":
      return createOpenAI({ apiKey })(modelName);
    case "vercel_ai_gateway":
    default:
      // For gateway or any unknown provider, route through the gateway
      return createGateway({ apiKey })(modelId);
  }
}

/**
 * Retrieves documents from the knowledge base — either via the running
 * generated server or directly from the local vector store.
 */
async function queryKnowledgeBase(
  query: string,
  topK: number,
  serverId: string | null,
) {
  const doRetrieve = async () => {
    const config = await readConfig();

    // 1) Try running generated server first
    const server = await refreshServerStatus();
    if (server.running) {
      try {
        const res = await fetch(`${server.endpoint}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, topK }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json();
        if (res.ok && data.hits) {
          return {
            query,
            hits: (data.hits as any[]).map((h: any) => ({
              title: h.title ?? "Untitled",
              url: h.url ?? "",
              score: Number((h.score ?? 0).toFixed(3)),
              text: (h.text ?? "").slice(0, 1200),
            })),
          };
        }
      } catch {
        // Fall through to direct retrieval
      }
    }

    // 2) Direct retrieval from local vector store
    const run = await readRun();
    if (!run || run.status !== "completed" || (run.totalChunks ?? 0) === 0) {
      return { query, hits: [] };
    }

    const vector = await embedQuery(config, query);
    const adapter = await createAdapter(config);
    const hits = await adapter.query(vector, topK, query);

    return {
      query,
      hits: hits.map((h) => ({
        title: h.title ?? "Untitled",
        url: h.url ?? "",
        score: Number((h.score ?? 0).toFixed(3)),
        text: (h.text ?? "").slice(0, 1200),
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
  const gatewayModels = await getModelsByType("language");
  const allChatModels = gatewayModels.map(toChatDescriptor);

  const chatModelId =
    requestedModelId ||
    config.chatModelId ||
    getDefaultChatModel(allChatModels, provider)?.id ||
    "openai/gpt-4o-mini";

  // For gateway mode, always route through gateway. Otherwise use the model's own provider.
  const modelProvider = chatModelId.split("/")[0];
  const resolvedProvider =
    provider === "vercel_ai_gateway" ? "vercel_ai_gateway" : modelProvider || provider;

  const apiKey = config.chatApiKey || config.embeddingApiKey || undefined;
  console.log("Using API Key for chat:", apiKey ? `${apiKey.substring(0, 10)}...` : "NONE", "Provider:", resolvedProvider);
  const model = createChatModel(resolvedProvider, chatModelId, apiKey, config.customChatModels) as any;

  const result = streamText({
    model,
    system: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    tools: {
      searchKnowledgeBase: tool({
        description:
          "Search the private RAG knowledge base for relevant documents. Use this for factual questions about the indexed content.",
        inputSchema: z.object({
          query: z
            .string()
            .describe("The search query for the knowledge base."),
        }),
        execute: async ({ query }) => {
          return queryKnowledgeBase(query, 5, serverId ?? null);
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error("[chat] stream error:", error);
      const message = error instanceof Error ? error.message : String(error);
      return message || "Something went wrong while generating a response.";
    },
  });
}
