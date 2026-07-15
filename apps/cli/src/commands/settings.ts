import * as p from "@clack/prompts";
import { readConfig, writeConfig } from "@larkup/core/config-store";
import { getAllModels } from "@larkup/core/models-cache";
import { toChatDescriptor } from "@larkup/core/chat-models/registry";
import { log } from "../ui/logger";
import { inServerScope, requireActive } from "../lib/scope";

export async function settingsCommand(options: { server?: string }) {
  await inServerScope(options.server, async () => {
    await requireActive();
    const config = await readConfig();

    log.info(log.fmt.bold("\n--- CLI Settings ---"));

    const gatewayModels = await getAllModels();
    const chatModels = gatewayModels
      .filter((m) => m.type === "language")
      .map(toChatDescriptor);

    const providers = Array.from(new Set(chatModels.map((m) => m.provider)));

    const selectedProvider = await p.select({
      message: "Select AI Provider for Chat:",
      initialValue: config.chatProvider || config.embeddingProvider,
      options: providers.map((p) => ({ label: p, value: p })),
    });

    if (p.isCancel(selectedProvider)) {
      log.info("Cancelled.");
      return;
    }

    const availableModels = chatModels.filter(
      (m) => m.provider === selectedProvider,
    );

    const selectedModel = await p.select({
      message: "Select Chat Model:",
      initialValue: config.chatModelId || availableModels[0]?.id,
      options: availableModels.map((m) => ({ label: m.name, value: m.id })),
    });

    if (p.isCancel(selectedModel)) {
      log.info("Cancelled.");
      return;
    }

    await writeConfig({
      ...config,
      chatProvider: selectedProvider as string,
      chatModelId: selectedModel as string,
    });
    log.success(`Settings saved. Chat model set to ${selectedModel}.`);
  });
}
