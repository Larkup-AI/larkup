import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { readConfig } from "@larkup-rag/core/config-store";
import { readRun } from "@larkup-rag/core/index-store";
import { refreshServerStatus } from "@larkup-rag/core/generator/server-runtime";
import { createAdapter } from "@larkup-rag/vector-stores/factory";
import { embedQuery } from "@larkup-rag/core/indexing/embedder";
import { runWithServer } from "@larkup-rag/core/workspace";
import {
  getDefaultChatModel,
  getChatModel,
} from "@larkup-rag/core/chat-models/registry";

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createCohere } from "@ai-sdk/cohere";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGateway } from "@ai-sdk/gateway";

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful research assistant powered by a knowledge base.

You have one tool:
- "searchKnowledgeBase" — searches a private RAG knowledge base.

Guidelines:
- ALWAYS call the searchKnowledgeBase tool to load required documents from the RAG server before answering the user's messages, even for general questions.
- Synthesize a clear, well-structured answer based on the retrieved documents.
- Cite sources inline using markdown links to their URLs when available.
- Be concise and accurate. Never fabricate sources or facts.
- Don't reply to the user with a question — try to give the answer unless you truly need clarification.
`;

/**
 * Creates an AI SDK language model instance based on the provider and model ID.
 */
function createChatModel(provider: string, modelId: string, apiKey?: string) {
  const modelName = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
  const key = apiKey;

  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: key })(modelName);
    case "cohere":
      return createCohere({ apiKey: key })(modelName);
    case "mistral":
      return createMistral({ apiKey: key })(modelName);
    case "deepseek":
      return createDeepSeek({ apiKey: key })(modelName);
    case "vercel_ai_gateway":
      return createGateway({ apiKey: key })(modelId);
    case "openai":
    default:
      return createOpenAI({ apiKey: key })(modelName);
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

  // Resolve chat model: explicit request > config > default for provider
  const chatModelId =
    requestedModelId ||
    config.chatModelId ||
    getDefaultChatModel(provider)?.id ||
    "openai/gpt-4o-mini";

  const chatModelDescriptor = getChatModel(chatModelId);
  const resolvedProvider =
    provider === "vercel_ai_gateway"
      ? "vercel_ai_gateway"
      : chatModelDescriptor?.provider || provider;

  const model = createChatModel(resolvedProvider, chatModelId, config.chatApiKey || config.embeddingApiKey);

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
