import { ALL_MODELS } from "./models-list"

export interface GatewayModel {
  id: string
  name: string
  owned_by: string
  type: "language" | "embedding" | "image" | "video" | "reranking" | "realtime" | "speech" | "transcription"
  description?: string
  context_window?: number
  max_tokens?: number
  tags?: string[]
  pricing?: Record<string, string>
}

export interface GatewayProvider {
  id: string
  name: string
  modelCount: number
}

/** Get all models from static list. */
export async function getAllModels(): Promise<GatewayModel[]> {
  return ALL_MODELS
}

export async function getModelsByType(type: GatewayModel["type"]): Promise<GatewayModel[]> {
  return (await getAllModels()).filter((m) => m.type === type)
}

export async function getModelsByProvider(provider: string, type?: GatewayModel["type"]): Promise<GatewayModel[]> {
  return (await getAllModels()).filter((m) => m.owned_by === provider && (!type || m.type === type))
}

export async function getAllProviders(type?: GatewayModel["type"]): Promise<GatewayProvider[]> {
  const all = await getAllModels()
  const filtered = type ? all.filter((m) => m.type === type) : all
  const map = new Map<string, number>()
  for (const m of filtered) map.set(m.owned_by, (map.get(m.owned_by) ?? 0) + 1)

  return Array.from(map.entries())
    .map(([id, count]) => ({
      id,
      name: PROVIDER_DISPLAY_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1),
      modelCount: count,
    }))
    .sort((a, b) => b.modelCount - a.modelCount)
}

export async function refreshModelsCache(): Promise<void> {
  // No-op since we use static list
}

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  amazon: "Amazon",
  xai: "xAI",
  perplexity: "Perplexity",
  alibaba: "Alibaba",
  groq: "Groq",
  "together-ai": "Together AI",
  fireworks: "Fireworks",
  cerebras: "Cerebras",
  voyage: "Voyage AI",
  jina: "Jina AI",
  nomic: "Nomic",
  bfl: "Black Forest Labs",
  "arcee-ai": "Arcee AI",
  luma: "Luma",
  minimax: "MiniMax",
  elevenlabs: "ElevenLabs",
}
