type ToolResultPart = {
  type?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

function compactValue(value: unknown, toolName?: string): unknown {
  const jsonValue =
    typeof value === 'object' && value !== null && (value as { type?: string }).type === 'json'
      ? (value as { value?: unknown }).value
      : value;
  const isJsonEnvelope = jsonValue !== value;
  const parsed = typeof jsonValue === 'string' ? tryParse(jsonValue) : jsonValue;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;

  const result = parsed as Record<string, any>;
  let compact: Record<string, any> | undefined;
  if (toolName === 'searchKnowledgeBase' && Array.isArray(result.hits)) {
    compact = {
      query: result.query,
      hits: result.hits.slice(0, 4).map((hit: any) => ({
        documentId: hit.documentId,
        title: hit.title,
        url: hit.url,
        score: hit.score,
        text: typeof hit.text === 'string' ? hit.text.slice(0, 1_200) : hit.text,
        images: Array.isArray(hit.images)
          ? hit.images.slice(0, 4).map((image: any) => ({
              imageUrl: image.imageUrl,
              pageNumber: image.pageNumber,
              index: image.index,
            }))
          : undefined,
        metadata: hit.metadata
          ? {
              mediaAssetId: hit.metadata.mediaAssetId,
              pageNumber: hit.metadata.pageNumber,
              contentKind: hit.metadata.contentKind,
            }
          : undefined,
      })),
      // The evidence-first shortcut embeds a completed video investigation
      // directly on the search result (see searchKnowledgeBase's execute()
      // in chat/tools.ts) so a model that stops after one tool call still
      // has what it needs. Dropping it here left the model with nothing to
      // answer from on the next step -- observed live as a completely empty
      // final response despite the video having been found correctly.
      ...(result.videoEvidence !== undefined ? { videoEvidence: result.videoEvidence } : {}),
    };
  } else if (toolName === 'queryTabularData' && Array.isArray(result.rows)) {
    compact = {
      columns: result.columns,
      rows: result.rows.slice(0, 50),
      totalRows: result.totalRows,
      aggregationResults: result.aggregationResults,
    };
  } else if (toolName === 'executeAnalysis') {
    compact = {
      stdout: typeof result.stdout === 'string' ? result.stdout.slice(0, 4_000) : result.stdout,
      stderr: typeof result.stderr === 'string' ? result.stderr.slice(0, 1_000) : result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!compact) return value;
  const serialized = typeof jsonValue === 'string' ? JSON.stringify(compact) : compact;
  return isJsonEnvelope ? { ...(value as Record<string, unknown>), value: serialized } : serialized;
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Removing every tool for the final answer step (activeTools: [],
 * toolChoice: 'none') isn't always enough signal on its own -- observed
 * live with a reasoning-tagged model (Claude Sonnet 4.6) on a large,
 * evidence-heavy video investigation: it burned a few output tokens and
 * finished with no tool call and no text at all, leaving the turn looking
 * answered (citations rendered from the tool result) but silently empty.
 * An explicit nudge naming the moment ("you have every tool result now,
 * answer") reliably produced a real answer where the bare absence of tools
 * didn't -- reproduced and confirmed live before and after this fix.
 */
export function withFinalAnswerNudge(messages: readonly any[]): any[] {
  return [
    ...messages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'You have every tool result gathered above. Answer the original question now, directly, using that evidence -- do not call another tool.',
        },
      ],
    },
  ];
}

/** Keep rendered tool outputs intact while bounding the next model call's evidence. */
export function compactToolContextForModel(messages: readonly any[]): any[] {
  return messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((part: ToolResultPart) => {
        if (part.type !== 'tool-result') return part;
        if ('output' in part) {
          return { ...part, output: compactValue(part.output, part.toolName) };
        }
        if ('result' in part) {
          return { ...part, result: compactValue(part.result, part.toolName) };
        }
        return part;
      }),
    };
  });
}
