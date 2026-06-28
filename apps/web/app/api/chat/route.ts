import { NextResponse } from "next/server";
import { stepCountIs, streamText, tool } from "ai";
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

const SYSTEM_PROMPT = `You are a helpful research assistant powered by a knowledge base.

You have one tool:
- "searchKnowledgeBase" — searches a private RAG knowledge base. Use it when you need factual information to answer the user's question.

Guidelines:
- For factual questions about the knowledge base, call searchKnowledgeBase first.
- Synthesize a clear, well-structured answer based on the retrieved documents.
- Cite sources inline using markdown links to their URLs when available.
- Be concise and accurate. Never fabricate sources or facts.
- For casual conversation or questions unrelated to the knowledge base, respond naturally without using the tool.
`;

/**
 * Creates an AI SDK model instance based on the provider and model ID.
 */
function createChatModel(provider: string, modelId: string) {
  // Extract the model name (part after provider/)
  const modelName = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
  const apiKey =
    process.env.AI_GATEWAY_API_KEY || process.env.EMBEDDING_API_KEY;

  switch (provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case "cohere":
      return createCohere({ apiKey })(modelName);
    case "mistral":
      return createMistral({ apiKey })(modelName);
    case "deepseek":
      return createDeepSeek({ apiKey })(modelName);
    case "vercel_ai_gateway":
      return createGateway({ apiKey })(modelId);
    case "openai":
    default:
      return createOpenAI({ apiKey })(modelName);
  }
}

/**
 * Retrieves documents from the knowledge base — either via the running
 * server or directly from the vector store.
 */
async function retrieveFromKB(
  query: string,
  topK: number,
  serverId: string | null,
) {
  const doRetrieve = async () => {
    const config = await readConfig();

    // Try running server first
    const server = await refreshServerStatus();
    if (server.running) {
      try {
        const apiKey = localStorage?.getItem?.("rag_server_api_key") || "";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch(`${server.endpoint}/query`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, topK }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json();
        if (res.ok && data.hits) return data.hits;
      } catch {
        // Fall through to direct retrieval
      }
    }

    // Direct retrieval
    const run = await readRun();
    if (!run || run.status !== "completed" || (run.totalChunks ?? 0) === 0) {
      return [];
    }

    const vector = await embedQuery(config, query);
    const adapter = await createAdapter(config);
    return adapter.query(vector, topK, query);
  };

  return serverId ? runWithServer(serverId, doRetrieve) : doRetrieve();
}

export async function POST(req: Request) {
  let body: {
    messages?: any[];
    serverId?: string;
    chatModelId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = body.messages ?? [];
  if (!messages.length) {
    return NextResponse.json(
      { error: "Messages array is required." },
      { status: 400 },
    );
  }

  const config = await readConfig();
  const provider = config.embeddingProvider;

  // Resolve chat model: explicit override > config > default for provider
  const chatModelId =
    body.chatModelId ||
    config.chatModelId ||
    getDefaultChatModel(provider)?.id ||
    "openai/gpt-4o-mini";

  const chatModelDescriptor = getChatModel(chatModelId);
  const resolvedProvider = chatModelDescriptor?.provider || provider;

  let model;
  try {
    model = createChatModel(resolvedProvider, chatModelId);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to initialize chat model "${chatModelId}": ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  const serverId = body.serverId ?? null;

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages,
    stopWhen: stepCountIs(5),
    tools: {
      searchKnowledgeBase: tool({
        description:
          "Search the private RAG knowledge base for relevant documents. Use this for factual questions about the indexed content.",
        parameters: z.object({
          query: z
            .string()
            .describe("The search query for the knowledge base."),
        }),
        execute: async ({ query }) => {
          const hits = await retrieveFromKB(query, 5, serverId);
          return {
            query,
            hits: (Array.isArray(hits) ? hits : []).map((h: any) => ({
              title: h.title || "Untitled",
              url: h.url || undefined,
              score: Number((h.score ?? 0).toFixed(3)),
              text: (h.text || "").slice(0, 1200),
            })),
          };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
