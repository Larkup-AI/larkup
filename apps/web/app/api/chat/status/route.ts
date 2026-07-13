import { NextResponse } from "next/server";
import { readConfig } from "@larkup/core/config-store";
import { readRun } from "@larkup/core/index-store";
import { runWithServer } from "@larkup/core/workspace";
import {
  getChatModelsForProvider,
  getDefaultChatModel,
} from "@larkup/core/chat-models/registry";

export const dynamic = "force-dynamic";

function withServer<T>(serverId: string | null, fn: () => Promise<T>) {
  return serverId ? runWithServer(serverId, fn) : fn();
}

/**
 * GET /api/chat/status — readiness snapshot for the Chat stage.
 *
 * Reports whether there's an index ready to chat against, plus
 * the available chat models for the user's selected provider.
 */
export async function GET(req: Request) {
  const serverId = new URL(req.url).searchParams.get("serverId");
  return withServer(serverId, async () => {
    const config = await readConfig();
    const run = await readRun();

    const indexed = run?.status === "completed" && (run.totalChunks ?? 0) > 0;
    const hasApiKey = !!(config.chatApiKey || config.embeddingApiKey);

    const blockers: string[] = [];
    if (!hasApiKey) {
      blockers.push(
        "Set an API Key in Settings.",
      );
    }

    const provider = config.chatProvider || config.embeddingProvider;
    const models = getChatModelsForProvider(provider);
    const defaultModel = getDefaultChatModel(provider);
    const chatModelId =
      config.chatModelId || defaultModel?.id || "openai/gpt-4o-mini";

    return NextResponse.json({
      ready: hasApiKey,
      indexed,
      blockers,
      provider,
      chatModelId,
      availableModels: models.map((m) => ({ id: m.id, label: m.label, provider: m.provider })),
      suggestions: config.chatSuggestions || [],
    });
  });
}

