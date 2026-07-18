import { NextResponse } from "next/server";
import { embed, generateText } from "ai";
import { getAIModel } from "@larkup/core/embeddings/providers";
import { getEmbeddingModel } from "@larkup/core/embeddings/registry";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createCohere } from "@ai-sdk/cohere";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { CustomModelConfig } from "@larkup/core/types";

export const runtime = "nodejs";

const DEFAULT_CHAT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  mistral: "mistral-small-latest",
  deepseek: "deepseek-chat",
  cohere: "command-r",
  vercel_ai_gateway: "openai/gpt-4o-mini",
};

const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: "openai/text-embedding-3-small",
  google: "google/gemini-embedding-001",
  cohere: "cohere/embed-english-v3.0",
  mistral: "mistral/mistral-embed",
  vercel_ai_gateway: "openai/text-embedding-3-small",
};

function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels?: CustomModelConfig[],
) {
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
      return createGateway({ apiKey })(modelId);
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    embeddingProvider,
    embeddingApiKey,
    embeddingModelId,
    chatProvider,
    chatApiKey,
    chatModelId,
    customChatModels,
    customEmbeddings,
  } = body;

  if (!embeddingProvider && !chatProvider) {
    return NextResponse.json(
      { error: "No provider fields to verify" },
      { status: 400 },
    );
  }

  // ── Verify Embedding ────────────────────────────────────────────────
  if (embeddingProvider) {
    try {
      const resolvedEmbeddingProvider =
        embeddingProvider === "vercel_ai_gateway"
          ? "vercel_ai_gateway"
          : embeddingProvider;

      let resolvedEmbeddingModelId = embeddingModelId;

      // For non-gateway, non-custom providers: validate the model belongs to the provider
      if (
        resolvedEmbeddingModelId &&
        resolvedEmbeddingProvider !== "vercel_ai_gateway" &&
        resolvedEmbeddingProvider !== "custom"
      ) {
        const modelInfo =
          getEmbeddingModel(resolvedEmbeddingModelId) ||
          getEmbeddingModel(
            `${resolvedEmbeddingProvider}/${resolvedEmbeddingModelId}`,
          );

        if (!modelInfo || modelInfo.provider !== resolvedEmbeddingProvider) {
          resolvedEmbeddingModelId = ""; // mismatch or unknown, force fallback
        }
      }

      // Fall back to a known-stable default if no model selected
      if (!resolvedEmbeddingModelId) {
        resolvedEmbeddingModelId =
          DEFAULT_EMBEDDING_MODELS[resolvedEmbeddingProvider] ||
          DEFAULT_EMBEDDING_MODELS["openai"];
      }

      // Handle custom embedding models
      if (
        resolvedEmbeddingProvider === "custom" &&
        customEmbeddings &&
        customEmbeddings.length > 0
      ) {
        resolvedEmbeddingModelId = `custom:${customEmbeddings[0].modelName}`;
      }

      const configMock = {
        embeddingProvider,
        embeddingApiKey,
        embeddingModelId: resolvedEmbeddingModelId,
        customEmbeddings,
      } as any;
      const model = getAIModel(configMock);

      try {
        await embed({ model, value: "test" });
      } catch (err: any) {
        const msg = err.message || "";

        // If the selected model is not found, provide actionable error
        if (
          msg.includes("not found") ||
          msg.includes("not available") ||
          msg.includes("no longer available") ||
          msg.includes("does not exist")
        ) {
          // For Google, try to list available models
          if (resolvedEmbeddingProvider === "google") {
            try {
              const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${embeddingApiKey}`,
              );
              const data = await res.json();
              const embedModels = (data.models || [])
                .filter((m: any) =>
                  m.supportedGenerationMethods?.includes("embedContent"),
                )
                .map((m: any) => m.name);
              return NextResponse.json(
                {
                  error: `Embedding model "${resolvedEmbeddingModelId}" is not available for your API key. Available models: ${embedModels.join(", ")}`,
                },
                { status: 400 },
              );
            } catch {
              // ignore listing error
            }
          }

          return NextResponse.json(
            {
              error: `Embedding model "${resolvedEmbeddingModelId}" is not available. Please select a different model or check your API key.`,
            },
            { status: 400 },
          );
        }

        return NextResponse.json(
          { error: `Embedding verification failed: ${msg}` },
          { status: 400 },
        );
      }
    } catch (err: any) {
      return NextResponse.json(
        { error: `Embedding Error: ${err.message}` },
        { status: 400 },
      );
    }
  }

  // ── Verify Chat ─────────────────────────────────────────────────────
  if (chatProvider) {
    try {
      const resolvedProvider =
        chatProvider === "vercel_ai_gateway"
          ? "vercel_ai_gateway"
          : chatProvider;

      // Use the user's selected model if provided, otherwise use a stable default
      let modelId: string;
      if (
        resolvedProvider === "custom" &&
        customChatModels &&
        customChatModels.length > 0
      ) {
        modelId = `custom:${customChatModels[0].modelName}`;
      } else if (chatModelId) {
        // User selected a specific model — verify with THAT model
        modelId = chatModelId;
      } else {
        // No model selected, use a stable default for the provider
        modelId =
          resolvedProvider === "vercel_ai_gateway"
            ? DEFAULT_CHAT_MODELS["vercel_ai_gateway"]
            : `${resolvedProvider}/${DEFAULT_CHAT_MODELS[resolvedProvider] || "gpt-4o-mini"}`;
      }

      const model = createChatModel(
        resolvedProvider,
        modelId,
        chatApiKey,
        customChatModels,
      ) as any;

      try {
        await generateText({ model, prompt: "hi", maxOutputTokens: 16 });
      } catch (err: any) {
        const msg = err.message || "";

        // Model-specific unavailability — tell the user exactly which model failed
        if (
          msg.includes("not found") ||
          msg.includes("not available") ||
          msg.includes("no longer available") ||
          msg.includes("does not exist") ||
          msg.includes("is not supported for generateContent")
        ) {
          // If a user-selected model failed, provide a clear message
          if (chatModelId) {
            return NextResponse.json(
              {
                error: `Chat model "${modelId}" is not available for your API key. Please select a different model.`,
              },
              { status: 400 },
            );
          }

          return NextResponse.json(
            {
              error: `The default test model for ${chatProvider} could not be verified. Your API key might only support specific models. Please select a model manually.`,
            },
            { status: 400 },
          );
        }

        // Authentication / quota errors
        if (
          msg.includes("API key") ||
          msg.includes("authentication") ||
          msg.includes("unauthorized") ||
          msg.includes("401")
        ) {
          return NextResponse.json(
            {
              error: `Chat API key is invalid or unauthorized for ${chatProvider}. Please check your key.`,
            },
            { status: 400 },
          );
        }

        return NextResponse.json(
          { error: `Chat verification failed: ${msg}` },
          { status: 400 },
        );
      }
    } catch (err: any) {
      return NextResponse.json(
        { error: `Chat Error: ${err.message}` },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ success: true });
}
