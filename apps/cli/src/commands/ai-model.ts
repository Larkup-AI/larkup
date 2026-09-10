import { readConfig, writeConfig } from '@larkup/core/config-store';
import { EMBEDDING_MODELS, getEmbeddingModel } from '@larkup/core/embeddings/registry';
import { getAllModels, type GatewayModel } from '@larkup/core/models-cache';
import { log } from '../ui/logger';
import { inProjectScope, requireActiveProject } from '../lib/scope';

type ModelCapability = 'embedding' | 'chat' | 'vision';

interface AiModelOptions {
  project?: string;
  embedding?: string;
  chat?: string;
  vision?: string;
  apiKey?: string;
  apikey?: string;
  type?: ModelCapability;
}

function modelProvider(modelId: string): string {
  return modelId.split('/')[0] || 'openai';
}

function supportsVision(model: GatewayModel): boolean {
  return model.type === 'language' && Boolean(model.tags?.includes('vision'));
}

function printModel(model: { id: string; name?: string; owned_by?: string; description?: string }) {
  log.info(`${model.id}${model.name && model.name !== model.id ? `  ${model.name}` : ''}`);
  if (model.description) log.dim(`  ${model.description}`);
}

async function listModels(type?: ModelCapability) {
  const models = await getAllModels();
  const selectedType = type ?? 'embedding';
  if (selectedType === 'embedding') {
    for (const model of EMBEDDING_MODELS) printModel({ ...model, name: model.label });
    return;
  }

  const matching = models.filter(
    selectedType === 'vision'
      ? supportsVision
      : (model) => model.type === 'language' && model.tags?.includes('tool-use'),
  );
  for (const model of matching) printModel(model);
}

function validateLanguageModel(
  models: GatewayModel[],
  modelId: string,
  capability: 'chat' | 'vision',
) {
  const model = models.find((candidate) => candidate.id === modelId);
  if (!model || model.type !== 'language') {
    throw new Error(
      `Unknown ${capability} model "${modelId}". Run: larkup ai-model list --type ${capability}`,
    );
  }
  if (capability === 'vision' && !supportsVision(model)) {
    throw new Error(
      `Model "${modelId}" is not vision-capable. Run: larkup ai-model list --type vision`,
    );
  }
  return model;
}

export async function aiModelCommand(action: string | undefined, options: AiModelOptions) {
  await inProjectScope(options.project, async () => {
    await requireActiveProject();
    if (action === 'list') {
      await listModels(options.type);
      return;
    }
    if (action && action !== 'show') {
      throw new Error(
        `Unknown ai-model action "${action}". Use "list" or omit the action to configure models.`,
      );
    }

    const config = await readConfig();
    const apiKey = options.apiKey ?? options.apikey;
    if (!options.embedding && !options.chat && !options.vision) {
      if (apiKey) {
        await writeConfig({ ...config, embeddingApiKey: apiKey });
        log.success('Embedding API key saved for the active Project.');
        return;
      }
      log.info(`Embedding  ${config.embeddingModelId}`);
      log.info(`Chat       ${config.chatModelId ?? 'not configured'}`);
      log.info(`Vision     ${config.visionModelId ?? 'not configured'}`);
      log.dim(
        'Set one with: larkup ai-model --embedding openai/text-embedding-3-small --api-key <key>',
      );
      return;
    }

    const models = await getAllModels();
    const next = { ...config };
    if (options.embedding) {
      const embedding = getEmbeddingModel(options.embedding);
      if (!embedding) {
        throw new Error(
          `Unknown embedding model "${options.embedding}". Run: larkup ai-model list --type embedding`,
        );
      }
      next.embeddingModelId = embedding.id;
      next.embeddingProvider = embedding.provider;
      if (apiKey) next.embeddingApiKey = apiKey;
    }
    if (options.chat) {
      const chat = validateLanguageModel(models, options.chat, 'chat');
      next.chatModelId = chat.id;
      next.chatProvider = modelProvider(chat.id);
      if (apiKey) next.chatApiKey = apiKey;
    }
    if (options.vision) {
      const vision = validateLanguageModel(models, options.vision, 'vision');
      next.visionModelId = vision.id;
      next.visionProvider = modelProvider(vision.id);
      if (apiKey) next.visionApiKey = apiKey;
    }

    await writeConfig(next);
    log.success('AI model settings saved. The Web UI now uses the same Project configuration.');
  });
}
