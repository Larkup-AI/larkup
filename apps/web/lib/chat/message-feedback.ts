export type AnswerFeedback = 'liked' | 'disliked';

type MessageWithMetadata = {
  metadata?: unknown;
};

type FeedbackMessage = MessageWithMetadata & {
  id: string;
  role?: string;
  parts?: unknown;
  toolInvocations?: unknown;
};

export interface GroundedAnswerFeedbackContext {
  question: string;
  answer: string;
  sourceScopeFingerprint?: string;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function answerFeedbackForMessage(message: MessageWithMetadata): AnswerFeedback | undefined {
  const feedback = metadataRecord(message.metadata).answerFeedback;
  return feedback === 'liked' || feedback === 'disliked' ? feedback : undefined;
}

/** Store feedback in message metadata so it travels with persisted chat history. */
export function withAnswerFeedback<T extends MessageWithMetadata>(
  message: T,
  feedback: AnswerFeedback | undefined,
): T {
  const currentMetadata = metadataRecord(message.metadata);
  const { answerFeedback: _answerFeedback, ...remainingMetadata } = currentMetadata;
  const metadata = feedback
    ? { ...remainingMetadata, answerFeedback: feedback }
    : remainingMetadata;

  return {
    ...message,
    ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
  };
}

export function updateAnswerFeedback<T extends MessageWithMetadata & { id: string }>(
  messages: readonly T[],
  messageId: string,
  feedback: AnswerFeedback | undefined,
): T[] {
  return messages.map((message) =>
    message.id === messageId ? withAnswerFeedback(message, feedback) : message,
  );
}

function unwrapJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return unwrapJson(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'json' &&
    'value' in value
  ) {
    return unwrapJson((value as { value?: unknown }).value);
  }
  return value;
}

function messageText(message: FeedbackMessage): string {
  if (!Array.isArray(message.parts)) return '';
  return message.parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n\n')
    .trim();
}

function toolResults(message: FeedbackMessage) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const fromParts = parts.flatMap((part: any) => {
    if (part?.type === 'tool-invocation') {
      return [
        {
          name: part.toolInvocation?.toolName,
          output: part.toolInvocation?.result,
        },
      ];
    }
    if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
      return [{ name: part.type.slice('tool-'.length), output: part.output ?? part.result }];
    }
    if (part?.type === 'dynamic-tool') {
      return [{ name: part.toolName, output: part.output ?? part.result }];
    }
    return [];
  });
  const invocations = Array.isArray(message.toolInvocations) ? message.toolInvocations : [];
  return [
    ...fromParts,
    ...invocations.map((invocation: any) => ({
      name: invocation?.toolName,
      output: invocation?.result,
    })),
  ];
}

function cachedScopeFingerprint(message: FeedbackMessage): string | undefined {
  const cache = metadataRecord(message.metadata).groundedAnswerCache;
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return undefined;
  const fingerprint = (cache as Record<string, unknown>).sourceScopeFingerprint;
  return typeof fingerprint === 'string' && fingerprint ? fingerprint : undefined;
}

/** Extracts a safe plain-document answer that can be promoted by Like. */
export function groundedAnswerFeedbackContext(
  messages: readonly FeedbackMessage[],
  assistantMessageId: string,
): GroundedAnswerFeedbackContext | undefined {
  const assistantIndex = messages.findIndex(
    (message) => message.id === assistantMessageId && message.role === 'assistant',
  );
  if (assistantIndex < 0) return undefined;
  const assistant = messages[assistantIndex];
  const answer = messageText(assistant);
  if (!answer) return undefined;

  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex -= 1;
  if (userIndex < 0) return undefined;
  const question = messageText(messages[userIndex]);
  if (!question) return undefined;

  const metadataFingerprint = cachedScopeFingerprint(assistant);
  const tools = toolResults(assistant);
  if (tools.some((tool) => tool.name && tool.name !== 'searchKnowledgeBase')) return undefined;
  if (metadataFingerprint && tools.length === 0) {
    return { question, answer, sourceScopeFingerprint: metadataFingerprint };
  }

  const search = tools
    .filter((tool) => tool.name === 'searchKnowledgeBase')
    .map((tool) => unwrapJson(tool.output) as Record<string, unknown> | undefined)
    .find((output) => Array.isArray(output?.hits) && output.hits.length > 0);
  if (!search || search.videoEvidence) return undefined;
  if (
    (search.hits as Array<Record<string, any>>).some(
      (hit) => hit?.mediaAssetId || hit?.metadata?.mediaAssetId,
    )
  ) {
    return undefined;
  }
  return {
    question,
    answer,
    ...(typeof search.sourceScopeFingerprint === 'string'
      ? { sourceScopeFingerprint: search.sourceScopeFingerprint }
      : {}),
  };
}
