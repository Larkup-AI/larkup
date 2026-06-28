import * as p from "@clack/prompts";
import { readConfig, writeConfig } from "@larkup-rag/core/config-store";
import { CHAT_MODELS } from "@larkup-rag/core/chat-models/registry";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

export async function settingsCommand(options: { server?: string }) {
  await inServerScope(options.server, async () => {
    await requireActive();
    const config = await readConfig();

    log.info(log.fmt.bold("\n--- CLI Settings ---"));
    
    // For now we just implement the chat model selection setting.
    // Group models by provider for a better UI.
    const providers = Array.from(new Set(CHAT_MODELS.map((m) => m.provider)));
    
    const selectedProvider = await p.select({
      message: "Select AI Provider for Chat:",
      initialValue: config.embeddingProvider,
      options: providers.map(p => ({ label: p, value: p }))
    });

    if (p.isCancel(selectedProvider)) {
      log.info("Cancelled.");
      return;
    }

    const availableModels = CHAT_MODELS.filter((m) => m.provider === selectedProvider);
    
    const selectedModel = await p.select({
      message: "Select Chat Model:",
      initialValue: config.chatModelId || availableModels[0]?.id,
      options: availableModels.map(m => ({ label: m.label, value: m.id }))
    });

    if (p.isCancel(selectedModel)) {
      log.info("Cancelled.");
      return;
    }

    await writeConfig({ ...config, chatModelId: selectedModel as string });
    log.success(`Settings saved. Chat model set to ${selectedModel}.`);
  });
}
