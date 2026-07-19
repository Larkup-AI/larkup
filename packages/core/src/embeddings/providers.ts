import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createCohere } from "@ai-sdk/cohere";
import { createMistral } from "@ai-sdk/mistral";
// @ts-ignore
import { createGateway } from "@ai-sdk/gateway";
import type { RagConfig } from "../types";

/** Helper to construct the AI SDK model object from config */
export function getAIModel(config: RagConfig): any {
  let modelName = config.embeddingModelId;
  if (modelName.includes("/")) {
    modelName = modelName.split("/")[1];
  }

  const explicitApiKey = config.embeddingApiKey?.trim() || "NO_API_KEY_PROVIDED_FROM_UI";

  // Handle custom customEmbeddings
  if (config.embeddingModelId.startsWith("custom:")) {
    const customName = config.embeddingModelId.slice("custom:".length);
    const custom = (config.customEmbeddings ?? []).find(
      (m) => m.modelName === customName,
    );
    if (custom) {
      const customProvider = createOpenAICompatible({
        name: "custom_provider",
        baseURL: custom.baseUrl,
        apiKey: custom.apiKey || config.embeddingApiKey || undefined,
      });
      return customProvider.embeddingModel(custom.modelName);
    }
  }

  if (config.embeddingProvider === "deepseek") {
    const deepseek = createDeepSeek({
      apiKey: explicitApiKey,
    });
    return deepseek.embeddingModel(modelName);
  }

  if (config.embeddingProvider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: explicitApiKey,
    });
    return google.textEmbeddingModel(modelName);
  }

  if (config.embeddingProvider === "cohere") {
    const cohere = createCohere({
      apiKey: explicitApiKey,
    });
    return cohere.embedding(modelName);
  }

  if (config.embeddingProvider === "mistral") {
    const mistral = createMistral({
      apiKey: explicitApiKey,
    });
    return mistral.embedding(modelName);
  }

  if (config.embeddingProvider === "vercel_ai_gateway") {
    const gateway = createGateway({
      apiKey: explicitApiKey,
    });
    return gateway.embedding(config.embeddingModelId);
  }

  // Default fallback (e.g. "openai")
  const openai = createOpenAI({
    apiKey: explicitApiKey,
  });
  return openai.embedding(modelName);
}
