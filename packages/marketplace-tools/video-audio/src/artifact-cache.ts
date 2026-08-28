import { createHash } from 'node:crypto';

export interface ArtifactCacheKeyInput {
  contentHash: string;
  operation: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  configuration?: Record<string, string | number | boolean | undefined>;
}

/** Stable cache key that never includes secrets or local filesystem paths. */
export function createArtifactCacheKey(input: ArtifactCacheKeyInput): string {
  const configuration = Object.entries(input.configuration ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(
      JSON.stringify({
        contentHash: input.contentHash,
        operation: input.operation,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        configuration,
      }),
    )
    .digest('hex');
}
