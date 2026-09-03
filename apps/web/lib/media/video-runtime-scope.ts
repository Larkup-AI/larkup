import type { SourceDocument } from '@larkup/core/types';

export type VideoRuntimeScope = 'local' | 'cloud';

export function videoRuntimeScopeFromConfig(
  config: { toolConfigs?: Record<string, Record<string, unknown>> } | undefined,
): VideoRuntimeScope {
  const toolConfigs = config?.toolConfigs;
  const runtimeMode =
    toolConfigs && typeof toolConfigs === 'object'
      ? (toolConfigs as Record<string, Record<string, unknown>>)['video-intelligence']?.runtimeMode
      : undefined;
  return runtimeMode === 'local' ||
    runtimeMode === 'local-docker' ||
    runtimeMode === 'local-process'
    ? 'local'
    : 'cloud';
}

export function videoRuntimeScopeFromMetadata(metadata: SourceDocument['metadata'] | undefined) {
  const scope = metadata?.videoRuntimeScope;
  return scope === 'local' || scope === 'cloud' ? scope : undefined;
}

/** Legacy media remains available until a re-index records its actual scope. */
export function isDocumentAvailableInVideoRuntime(
  document: Pick<SourceDocument, 'source' | 'metadata'>,
  activeScope: VideoRuntimeScope,
) {
  if (document.source !== 'media') return true;
  const scope = videoRuntimeScopeFromMetadata(document.metadata);
  return !scope || scope === activeScope;
}

export function videoRuntimeScopeLabel(scope: VideoRuntimeScope) {
  return scope === 'local' ? 'Local runtime' : 'Larkup Cloud';
}
