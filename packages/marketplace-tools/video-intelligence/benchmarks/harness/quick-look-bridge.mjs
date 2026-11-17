import { createHash } from 'node:crypto';
import { cachedRewatchModel } from './paid-rewatch-cache.mjs';
import { quickLook } from '../../../../workspace-server/src/lib/media/video/quick-look.ts';
import { createChatModel } from '../../../../workspace-server/src/lib/chat/model-provider.ts';

/** Reuse the canonical local re-watch, with explicit PC-only credentials and paid fences. */
export function benchmarkReWatch(input, raw, actions) {
  const apiKey = process.env.BENCHMARK_REWATCH_GATEWAY_KEY;
  const directory = process.env.BENCHMARK_REWATCH_CACHE_DIR;
  if (!apiKey || !directory || !input.sourcePath) throw Error('BENCHMARK_REWATCH_NOT_CONFIGURED');
  const name = process.env.BENCHMARK_REWATCH_MODEL || 'google/gemini-3.8-flash';
  const configuredTimeout = process.env.BENCHMARK_REWATCH_TIMEOUT_MS === undefined ? undefined : Number(process.env.BENCHMARK_REWATCH_TIMEOUT_MS);
  if (configuredTimeout !== undefined && (!Number.isFinite(configuredTimeout) || configuredTimeout < 1000 || configuredTimeout > 180000)) throw Error('BENCHMARK_REWATCH_TIMEOUT_INVALID');
  const base = createChatModel('vercel_ai_gateway', name, apiKey);
  const model = cachedRewatchModel(base, { directory, name, actions,
    caseKey: createHash('sha256').update(JSON.stringify([input.sourceId, input.question])).digest('hex'),
    limit: Number(process.env.BENCHMARK_REWATCH_MAX_CALLS ?? 4),
  });
  return async (sourceId, question, ranges, options = {}) => {
    if (sourceId !== input.sourceId) throw Error('SOURCE_SCOPE_MISMATCH');
    actions.push({ action: 'canonicalReWatchRequested', ranges });
    const findings = await quickLook({ mediaPath: input.sourcePath, question, ranges, model, maxRetries: 0,
      transcriptFor: (range) => (raw.transcript || []).filter((s) => s.endMs >= range.startSecs * 1000 && s.startMs <= range.endSecs * 1000).map((s) => s.text).join(' ').slice(0, 4000),
      signal: AbortSignal.timeout(configuredTimeout ?? Math.max(1000, Math.min(40000, options.maxWaitMs || 12000))),
    });
    if (findings.some((f) => f.error)) actions.push({ action: 'canonicalReWatchFailed', outcomeRequiresReconciliation: true });
    actions.push({ action: 'canonicalReWatchConsumed', completed: findings.filter((f) => !f.error).length,
      established: findings.filter((f) => f.settlesQuestion).length });
    return findings;
  };
}
