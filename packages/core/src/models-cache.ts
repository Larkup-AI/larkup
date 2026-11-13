import { ALL_MODELS } from './models-list';

export interface GatewayModel {
  id: string;
  name: string;
  owned_by: string;
  type:
    | 'language'
    | 'embedding'
    | 'image'
    | 'video'
    | 'reranking'
    | 'realtime'
    | 'speech'
    | 'transcription';
  description?: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  pricing?: Record<string, any>;
}

export interface GatewayProvider {
  id: string;
  name: string;
  modelCount: number;
}

let cachedModels: GatewayModel[] | undefined;
let refreshedAt = 0;
let pendingRefresh: Promise<GatewayModel[]> | undefined;
const CACHE_TTL_MS = 5 * 60_000;

/** Validate public catalog data before replacing the last usable model list. */
export async function loadGatewayModels(fetcher: typeof fetch = fetch): Promise<GatewayModel[]> {
  const response = await fetcher('https://ai-gateway.vercel.sh/v1/models', {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Model catalog unavailable (${response.status}).`);
  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error('Invalid model catalog.');
  const models = payload.data.filter(
    (model): model is GatewayModel =>
      model &&
      typeof model.id === 'string' &&
      typeof model.name === 'string' &&
      typeof model.owned_by === 'string' &&
      typeof model.type === 'string',
  );
  if (!models.some((model) => model.type === 'language')) throw new Error('Empty model catalog.');
  return models;
}

/** Cache the live catalog; retain last-known metadata during transient outages. */
export async function getAllModels(): Promise<GatewayModel[]> {
  if (cachedModels && Date.now() - refreshedAt < CACHE_TTL_MS) return cachedModels;
  if (!pendingRefresh)
    pendingRefresh = loadGatewayModels()
      .then((models) => {
        cachedModels = models;
        refreshedAt = Date.now();
        return models;
      })
      .catch(() => {
        refreshedAt = Date.now();
        return cachedModels ?? (cachedModels = ALL_MODELS);
      })
      .finally(() => {
        pendingRefresh = undefined;
      });
  return pendingRefresh;
}

/** Use refreshed metadata for synchronous usage estimation after model resolution. */
export function getCachedGatewayModel(modelId: string): GatewayModel | undefined {
  return (
    cachedModels?.find((model) => model.id === modelId) ??
    ALL_MODELS.find((model) => model.id === modelId)
  );
}

export async function getModelsByType(type: GatewayModel['type']): Promise<GatewayModel[]> {
  return (await getAllModels()).filter((m) => m.type === type);
}

export async function getModelsByProvider(
  provider: string,
  type?: GatewayModel['type'],
): Promise<GatewayModel[]> {
  return (await getAllModels()).filter(
    (m) => m.owned_by === provider && (!type || m.type === type),
  );
}

export async function getAllProviders(type?: GatewayModel['type']): Promise<GatewayProvider[]> {
  const all = await getAllModels();
  const filtered = type ? all.filter((m) => m.type === type) : all;
  const map = new Map<string, number>();
  for (const m of filtered) map.set(m.owned_by, (map.get(m.owned_by) ?? 0) + 1);

  return Array.from(map.entries())
    .map(([id, count]) => ({
      id,
      name: PROVIDER_DISPLAY_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1),
      modelCount: count,
    }))
    .sort((a, b) => b.modelCount - a.modelCount);
}

export async function refreshModelsCache(): Promise<void> {
  refreshedAt = 0;
  await getAllModels();
}

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  meta: 'Meta',
  mistral: 'Mistral',
  cohere: 'Cohere',
  deepseek: 'DeepSeek',
  amazon: 'Amazon',
  xai: 'xAI',
  perplexity: 'Perplexity',
  alibaba: 'Alibaba',
  groq: 'Groq',
  'together-ai': 'Together AI',
  fireworks: 'Fireworks',
  cerebras: 'Cerebras',
  voyage: 'Voyage AI',
  jina: 'Jina AI',
  nomic: 'Nomic',
  bfl: 'Black Forest Labs',
  'arcee-ai': 'Arcee AI',
  luma: 'Luma',
  minimax: 'MiniMax',
  elevenlabs: 'ElevenLabs',
};
