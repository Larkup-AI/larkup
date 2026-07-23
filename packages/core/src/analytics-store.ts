import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir, requireDataDir } from './workspace';
import { ALL_MODELS } from './models-list';

export interface UsageEvent {
  id: string;
  type: 'chat' | 'embedding' | 'server_request' | 'media_processing';
  // Chat-specific
  modelId?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  // Embedding-specific
  embeddingModelId?: string;
  embeddingTokens?: number;
  chunkCount?: number;
  // Server request-specific
  endpoint?: string;
  method?: string;
  statusCode?: number;
  latencyMs?: number;
  // Media processing-specific
  mediaType?: 'image' | 'video' | 'audio';
  durationSecs?: number;
  frameCount?: number;
  // Cost
  estimatedCost?: number;
  // Common
  serverId?: string;
  timestamp: string;
}

export interface AnalyticsSummary {
  totalChatTokens: number;
  totalEmbeddingTokens: number;
  totalCost: number;
  totalRequests: number;
  chatTimeSeries: { date: string; tokens: number; cost: number; requests: number }[];
  embeddingTimeSeries: { date: string; tokens: number; cost: number; requests: number }[];
  serverTimeSeries: { date: string; requests: number; avgLatencyMs: number }[];
  modelBreakdown: {
    modelId: string;
    type: string;
    tokens: number;
    cost: number;
    requests: number;
  }[];
}

/**
 * File-backed store for analytics/usage tracking.
 * Writes are serialized to prevent data loss.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function analyticsPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, 'analytics.json');
}

export async function readUsageEvents(): Promise<UsageEvent[]> {
  const file = await analyticsPath(false);
  if (!file) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as UsageEvent[];
  } catch {
    return [];
  }
}

/**
 * Asynchronously track a usage event. Fire-and-forget safe.
 */
export function trackUsageEvent(event: Omit<UsageEvent, 'id'>): Promise<UsageEvent> {
  return serialize(async () => {
    const events = await readUsageEvents();
    const fullEvent: UsageEvent = {
      ...event,
      id: randomUUID(),
    };
    events.push(fullEvent);

    const file = await analyticsPath(true);
    if (file) {
      await fs.writeFile(file, JSON.stringify(events, null, 2), 'utf8');
    }
    return fullEvent;
  });
}

export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  if (modelId.startsWith('custom:')) return 0;

  const model = ALL_MODELS.find((m) => m.id === modelId);
  if (!model || !model.pricing) return 0;

  const inputPrice = parseFloat(model.pricing.input || '0');
  const outputPrice = parseFloat(model.pricing.output || '0');

  return promptTokens * inputPrice + completionTokens * outputPrice;
}

export async function getAnalyticsSummary(days: number): Promise<AnalyticsSummary> {
  const events = await readUsageEvents();

  const now = new Date();
  const cutoff = days > 0 ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : new Date(0);

  const filtered = events.filter((e) => new Date(e.timestamp) >= cutoff);

  const summary: AnalyticsSummary = {
    totalChatTokens: 0,
    totalEmbeddingTokens: 0,
    totalCost: 0,
    totalRequests: 0,
    chatTimeSeries: [],
    embeddingTimeSeries: [],
    serverTimeSeries: [],
    modelBreakdown: [],
  };

  const chatMap = new Map<string, { tokens: number; cost: number; requests: number }>();
  const embeddingMap = new Map<string, { tokens: number; cost: number; requests: number }>();
  const serverMap = new Map<string, { requests: number; totalLatency: number }>();
  const modelMap = new Map<
    string,
    { type: string; tokens: number; cost: number; requests: number }
  >();

  for (const ev of filtered) {
    const dateStr = new Date(ev.timestamp).toISOString().split('T')[0];

    if (ev.type === 'chat') {
      summary.totalChatTokens += ev.totalTokens || 0;
      summary.totalCost += ev.estimatedCost || 0;

      const dayData = chatMap.get(dateStr) || { tokens: 0, cost: 0, requests: 0 };
      dayData.tokens += ev.totalTokens || 0;
      dayData.cost += ev.estimatedCost || 0;
      dayData.requests += 1;
      chatMap.set(dateStr, dayData);

      if (ev.modelId) {
        const mData = modelMap.get(ev.modelId) || { type: 'chat', tokens: 0, cost: 0, requests: 0 };
        mData.tokens += ev.totalTokens || 0;
        mData.cost += ev.estimatedCost || 0;
        mData.requests += 1;
        modelMap.set(ev.modelId, mData);
      }
    } else if (ev.type === 'embedding') {
      summary.totalEmbeddingTokens += ev.embeddingTokens || 0;
      summary.totalCost += ev.estimatedCost || 0;

      const dayData = embeddingMap.get(dateStr) || { tokens: 0, cost: 0, requests: 0 };
      dayData.tokens += ev.embeddingTokens || 0;
      dayData.cost += ev.estimatedCost || 0;
      dayData.requests += 1;
      embeddingMap.set(dateStr, dayData);

      if (ev.embeddingModelId) {
        const mData = modelMap.get(ev.embeddingModelId) || {
          type: 'embedding',
          tokens: 0,
          cost: 0,
          requests: 0,
        };
        mData.tokens += ev.embeddingTokens || 0;
        mData.cost += ev.estimatedCost || 0;
        mData.requests += 1;
        modelMap.set(ev.embeddingModelId, mData);
      }
    } else if (ev.type === 'media_processing') {
      summary.totalCost += ev.estimatedCost || 0;
      const modelId = ev.modelId || 'media-processing';
      const mData = modelMap.get(modelId) || {
        type: 'media_processing',
        tokens: 0,
        cost: 0,
        requests: 0,
      };
      mData.tokens += ev.totalTokens || 0;
      mData.cost += ev.estimatedCost || 0;
      mData.requests += 1;
      modelMap.set(modelId, mData);
    } else if (ev.type === 'server_request') {
      summary.totalRequests += 1;

      const dayData = serverMap.get(dateStr) || { requests: 0, totalLatency: 0 };
      dayData.requests += 1;
      dayData.totalLatency += ev.latencyMs || 0;
      serverMap.set(dateStr, dayData);
    }
  }

  summary.chatTimeSeries = Array.from(chatMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  summary.embeddingTimeSeries = Array.from(embeddingMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  summary.serverTimeSeries = Array.from(serverMap.entries())
    .map(([date, data]) => ({
      date,
      requests: data.requests,
      avgLatencyMs: data.requests > 0 ? Math.round(data.totalLatency / data.requests) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  summary.modelBreakdown = Array.from(modelMap.entries())
    .map(([modelId, data]) => ({ modelId, ...data }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);

  return summary;
}
