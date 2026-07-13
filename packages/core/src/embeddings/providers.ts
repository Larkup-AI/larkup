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
      apiKey: config.embeddingApiKey || undefined,
    });
    return deepseek.embeddingModel(modelName);
  }

  if (config.embeddingProvider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: config.embeddingApiKey || undefined,
    });
    return google.embedding(modelName);
  }

  if (config.embeddingProvider === "cohere") {
    const cohere = createCohere({
      apiKey: config.embeddingApiKey || undefined,
    });
    return cohere.embedding(modelName);
  }

  if (config.embeddingProvider === "mistral") {
    const mistral = createMistral({
      apiKey: config.embeddingApiKey || undefined,
    });
    return mistral.embedding(modelName);
  }

  if (config.embeddingProvider === "vercel_ai_gateway") {
    const gateway = createGateway({
      apiKey: config.embeddingApiKey || undefined,
    });
    // For Vercel AI Gateway, we don't slice the provider from the string, so we use config.embeddingModelId directly
    // Wait, the gateway model requires the original string, e.g., "openai/text-embedding-3-small"
    return gateway.embedding(config.embeddingModelId);
  }

  // Default fallback (e.g. "openai")
  const openai = createOpenAI({
    apiKey: config.embeddingApiKey || undefined,
  });
  return openai.embedding(modelName);
}
