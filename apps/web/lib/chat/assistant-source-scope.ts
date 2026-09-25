import { createHash } from 'node:crypto';
import type { SourceDocument } from '@larkup/core/types';

/**
 * Fingerprint every source property that can change a grounded text answer.
 * This permits an exact repeat to skip retrieval only while its source scope
 * and Assistant configuration remain unchanged.
 */
export function assistantSourceScopeFingerprint(
  documents: readonly SourceDocument[],
  context?: { configUpdatedAt?: string },
) {
  const hash = createHash('sha256');
  hash.update(context?.configUpdatedAt ?? '');
  for (const document of [...documents].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update('\0document\0');
    hash.update(
      JSON.stringify({
        id: document.id,
        title: document.title,
        url: document.url,
        source: document.source,
        content: document.content,
        groupId: document.groupId ?? 'default',
        enabled: document.enabled !== false,
        status: document.status,
        createdAt: document.createdAt,
      }),
    );
  }
  return hash.digest('hex');
}
