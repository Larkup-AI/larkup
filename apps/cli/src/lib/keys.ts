import * as p from "@clack/prompts";
import { readConfig, writeConfig } from "@larkup/core/config-store";
import { log } from "../ui/logger";

export async function ensureApiKey(
  config: Awaited<ReturnType<typeof readConfig>>,
  keyType: "embedding" | "chat" = "embedding"
) {
  const provider = keyType === "embedding"
    ? config.embeddingProvider
    : config.chatProvider || config.embeddingProvider;
  const envKey = providerEnvironmentKey(provider);
  const modelId = keyType === "embedding" ? config.embeddingModelId : config.chatModelId;
  const customModels = keyType === "embedding" ? config.customEmbeddings : config.customChatModels;
  const customKey = customModels?.find(
    (model) => model.modelName === modelId?.replace(/^custom:/, ""),
  )?.apiKey;
  const currentKey = keyType === "embedding"
    ? config.embeddingApiKey || customKey
    : config.chatApiKey || customKey || config.embeddingApiKey;
  
  if (envKey && !currentKey) {
    return;
  }

  if (!currentKey) {
    log.warn(`Your ${keyType} API key is not configured.`);
    const key = await p.text({
      message: `Please enter your ${provider} API key:`,
      placeholder: "sk-...",
    });

    if (p.isCancel(key)) {
      log.error("Canceled.");
      process.exit(1);
    }

    if (key && typeof key === "string" && key.trim()) {
      if (keyType === "embedding") {
        config.embeddingApiKey = key.trim();
      } else {
        config.chatApiKey = key.trim();
      }
      await writeConfig(config);
      log.success(`Saved API key to local configuration.`);
    } else {
      log.error("API Key is required to proceed.");
      process.exit(1);
    }
  }
}

function providerEnvironmentKey(provider: string) {
  const keys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
    cohere: process.env.COHERE_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    vercel_ai_gateway: process.env.AI_GATEWAY_API_KEY,
  };
  return keys[provider];
}
