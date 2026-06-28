import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import * as p from "@clack/prompts";
import { readConfig } from "@larkup-rag/core/config-store";
import { readRun } from "@larkup-rag/core/index-store";
import { refreshServerStatus } from "@larkup-rag/core/generator/server-runtime";
import { createAdapter } from "@larkup-rag/vector-stores/factory";
import { embedQuery } from "@larkup-rag/core/indexing/embedder";
import { getActiveServer } from "@larkup-rag/core/workspace";
import { getDefaultChatModel, getChatModel } from "@larkup-rag/core/chat-models/registry";

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createCohere } from "@ai-sdk/cohere";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGateway } from "@ai-sdk/gateway";

import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

const SYSTEM_PROMPT = `You are a helpful research assistant powered by a knowledge base.
You have one tool:
- "searchKnowledgeBase" — searches a private RAG knowledge base.

Guidelines:
- For factual questions about the knowledge base content, call searchKnowledgeBase.
- Synthesize a clear, well-structured answer based on the retrieved documents.
- Cite sources inline when available.
- Be concise and accurate. Never fabricate sources or facts.
- For casual conversation, respond naturally without using the tool.
`;

function createChatModel(provider: string, modelId: string) {
  const modelName = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.EMBEDDING_API_KEY;

  switch (provider) {
    case "google": return createGoogleGenerativeAI({ apiKey })(modelName);
    case "cohere": return createCohere({ apiKey })(modelName);
    case "mistral": return createMistral({ apiKey })(modelName);
    case "deepseek": return createDeepSeek({ apiKey })(modelName);
    case "vercel_ai_gateway": return createGateway({ apiKey })(modelId);
    case "openai":
    default: return createOpenAI({ apiKey })(modelName);
  }
}

async function queryKnowledgeBase(query: string, topK: number) {
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
      const data: any = await res.json();
      if (res.ok && data.hits) {
        return { query, hits: data.hits };
      }
    } catch {
      // Fall through to direct retrieval
    }
  }

  // 2) Direct retrieval
  const run = await readRun();
  if (!run || run.status !== "completed" || (run.totalChunks ?? 0) === 0) {
    return { query, hits: [] };
  }

  const vector = await embedQuery(config, query);
  const adapter = await createAdapter(config);
  const hits = await adapter.query(vector, topK, query);

  return { query, hits };
}

export async function chatCommand(options: { server?: string; model?: string }) {
  await inServerScope(options.server, async () => {
    const server = await requireActive();
    const config = await readConfig();
    const provider = config.embeddingProvider;

    const chatModelId =
      options.model ||
      config.chatModelId ||
      getDefaultChatModel(provider)?.id ||
      "openai/gpt-4o-mini";

    const descriptor = getChatModel(chatModelId);
    const resolvedProvider = descriptor?.provider || provider;
    
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.EMBEDDING_API_KEY) {
      log.warn("API Key is not set — chat will likely fail.");
    }

    log.info(log.fmt.cyan(`Starting chat session... (Type 'exit' to quit)`));
    log.dim(`Server: ${server.name} | Model: ${chatModelId}`);

    const aiModel = createChatModel(resolvedProvider, chatModelId);
    const messages: any[] = [];

    while (true) {
      const input = await p.text({
        message: log.fmt.bold("You:"),
        placeholder: "Ask something...",
      });

      if (p.isCancel(input)) {
        log.info("Goodbye.");
        process.exit(0);
      }

      const text = input.trim();
      if (!text) continue;
      if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
        log.info("Goodbye.");
        break;
      }

      messages.push({ role: "user", content: text });

      try {
        process.stdout.write(log.fmt.green(log.fmt.bold("Buddy: ")));
        
        const result = streamText({
          model: aiModel,
          system: SYSTEM_PROMPT,
          messages,
          stopWhen: stepCountIs(5),
          tools: {
            searchKnowledgeBase: tool({
              description: "Search the private knowledge base.",
              inputSchema: z.object({ query: z.string() }),
              execute: async ({ query }: { query: string }) => {
                log.dim(`\n[Tool: searching knowledge base for "${query}"]`);
                const res = await queryKnowledgeBase(query, 5);
                log.dim(`[Tool: found ${res.hits.length} results]\n`);
                return res;
              },
            }),
          },
        });

        let fullResponse = "";
        for await (const chunk of result.textStream) {
          process.stdout.write(log.fmt.green(chunk));
          fullResponse += chunk;
        }
        process.stdout.write("\n\n");

        messages.push({ role: "assistant", content: fullResponse });
      } catch (e: any) {
        log.error(`\nChat error: ${e.message}`);
        messages.pop(); // remove failed user message
      }
    }
  });
}
