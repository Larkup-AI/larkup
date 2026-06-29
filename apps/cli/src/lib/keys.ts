import * as p from "@clack/prompts";
import { readConfig, writeConfig } from "@larkup-rag/core/config-store";
import { log } from "../ui/logger";

export async function ensureApiKey(
  config: Awaited<ReturnType<typeof readConfig>>,
  keyType: "embedding" | "chat" = "embedding"
) {
  const currentKey = keyType === "embedding" ? config.embeddingApiKey : (config.chatApiKey || config.embeddingApiKey);
  
  if (!currentKey) {
    log.warn(`Your ${keyType} API key is not configured.`);
    const key = await p.text({
      message: `Please enter your ${config.embeddingProvider} API key:`,
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
