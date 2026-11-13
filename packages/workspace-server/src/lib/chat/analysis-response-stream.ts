/** Keep unverified calculation narratives out of the visible answer stream. */
export function verifiedAnalysisTextStream(enabled: boolean) {
  let verified = !enabled;
  const analysisCalls = new Set<string>();
  const hiddenTextIds = new Set<string>();
  return new TransformStream<any, any>({
    transform(chunk, controller) {
      if (
        chunk?.type === 'tool-input-available' &&
        ['executeAnalysis', 'analyzeCorpusWithCode'].includes(chunk.toolName)
      ) {
        analysisCalls.add(chunk.toolCallId);
      }
      if (chunk?.type === 'tool-output-available' && analysisCalls.has(chunk.toolCallId)) {
        const output = chunk.output;
        verified ||=
          output?.exitCode === 0 &&
          (output.presentation?.complete === true ||
            (typeof output.stdout === 'string' && output.stdout.trim().length > 0) ||
            (Array.isArray(output.artifacts) && output.artifacts.length > 0));
      }
      if (chunk?.type === 'text-start' && !verified) hiddenTextIds.add(chunk.id);
      if (
        ['text-start', 'text-delta', 'text-end'].includes(chunk?.type) &&
        (!verified || hiddenTextIds.has(chunk.id))
      ) {
        if (chunk.type === 'text-end') hiddenTextIds.delete(chunk.id);
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
