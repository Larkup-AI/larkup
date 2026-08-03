/**
 * Keeps retrieval routing deterministic before the chat model is asked to
 * decide whether a returned source is actually useful.
 */
function isMatchResultQuestion(text: string): boolean {
  return (
    /\b(?:who\s+won|winner|final\s+score|scoreline|match\s+result|what(?:'s|\s+is|\s+was)?\s+the\s+score)\b[\s\S]{0,120}\b(?:match|game|fixture|final|vs?\.?|versus)\b/i.test(
      text,
    ) ||
    /\b(?:match|game|fixture|final|vs?\.?|versus)\b[\s\S]{0,120}\b(?:who\s+won|winner|final\s+score|scoreline|result|score)\b/i.test(
      text,
    )
  );
}

export function requiresKnowledgeBaseSearch(text: string): boolean {
  const normalized = text.trim();
  if (/^(hi|hello|hey|thanks|thank you|ok|sure|yes|no|please|help)\b/i.test(normalized)) {
    return false;
  }

  return (
    /\b(my|our)\s+(favo(?:u)?rite|preference|choice|answer|name|result|score|winner)\b/i.test(
      normalized,
    ) ||
    /\b(?:what|which|who|where|when|how)\b[\s\S]{0,80}\b(my|our)\b/i.test(normalized) ||
    /\b(?:this|that|the)\s+(?:match|video|episode|recording|diagram|chart|image|page|section)\b/i.test(
      normalized,
    ) ||
    /\b(?:shown|listed|named|counted|under)\b[\s\S]{0,80}\b(?:image|diagram|chart|pdf|document|page|section|resources)\b/i.test(
      normalized,
    ) ||
    /\b(my|our)\s+(document|file|data|image|picture|diagram|video|audio|upload|corpus|knowledge|database|db|pdf|report|spreadsheet|presentation)\b/i.test(
      normalized,
    ) ||
    /\b(?:search|check|query)\s+(?:the\s+)?(?:knowledge base|corpus|database|db)\b/i.test(
      normalized,
    ) ||
    /\b(the|this|that)\s+(document|file|diagram|image|picture|upload|pdf|report)\b/i.test(
      normalized,
    ) ||
    // A named match is commonly a question about an indexed recording. The
    // user does not need to repeat "my video" for every follow-up question.
    isMatchResultQuestion(normalized) ||
    /\b(uploaded?|indexed|scraped|knowledge base|corpus)\b/i.test(normalized) ||
    /\bshow\s+me\b/i.test(normalized)
  );
}

type ChatMessageWithToolParts = {
  role?: string;
  parts?: unknown;
  toolInvocations?: unknown;
};

function resultHasHits(result: unknown): boolean {
  if (typeof result === 'string') {
    try {
      return resultHasHits(JSON.parse(result));
    } catch {
      return false;
    }
  }
  return (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray((result as { hits?: unknown }).hits) &&
    (result as { hits: unknown[] }).hits.length > 0
  );
}

/**
 * A follow-up may safely reuse evidence that is still in the conversation.
 * Do not reuse an empty search: a new, more specific wording can surface a
 * relevant chunk on the next attempt.
 */
export function hasPriorKnowledgeBaseEvidence(messages: ChatMessageWithToolParts[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant') return false;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const toolPartsContainHits = parts.some((part: any) => {
      if (part?.type === 'tool-invocation') {
        return (
          part.toolInvocation?.toolName === 'searchKnowledgeBase' &&
          resultHasHits(part.toolInvocation?.result)
        );
      }
      return part?.type === 'tool-searchKnowledgeBase' && resultHasHits(part.output ?? part.result);
    });
    if (toolPartsContainHits) return true;

    const invocations = Array.isArray(message.toolInvocations) ? message.toolInvocations : [];
    return invocations.some(
      (invocation: any) =>
        invocation?.toolName === 'searchKnowledgeBase' && resultHasHits(invocation?.result),
    );
  });
}

/**
 * Keep retrieval efficient for natural continuations such as "what about it?"
 * while treating every new standalone question as a fresh lookup.
 */
export function isLikelyKnowledgeFollowUp(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^(?:and|also|then|so)\b/.test(normalized) ||
    /^(?:tell me more|continue|go on|can you (?:explain|elaborate|clarify))\b/.test(normalized) ||
    /\b(?:it|this|that|they|them|those|these|its|their)\b/.test(normalized)
  );
}

export function canReuseKnowledgeBaseEvidence(
  text: string,
  messages: ChatMessageWithToolParts[],
): boolean {
  return isLikelyKnowledgeFollowUp(text) && hasPriorKnowledgeBaseEvidence(messages);
}

/** The chat workspace is intentionally a retrieval-only experience. */
export function requiresCurrentWebSearch(text: string): boolean {
  void text;
  return false;
}

/** Only the first retrieval is forced. The other source remains available for
 * exactly one recovery attempt; subsequent steps are reserved for analysis and
 * the final answer. */
export function retrievalToolsForStep<ToolName extends string>(options: {
  stepNumber: number;
  forceKnowledgeBaseSearch: boolean;
  forceWebSearch: boolean;
  toolNames: readonly ToolName[];
}): { toolChoice?: { type: 'tool'; toolName: ToolName }; activeTools?: ToolName[] } | undefined {
  const { stepNumber, forceKnowledgeBaseSearch, forceWebSearch, toolNames } = options;
  const without = (...blocked: string[]) => toolNames.filter((name) => !blocked.includes(name));

  if (stepNumber === 0 && forceKnowledgeBaseSearch) {
    return { toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' as ToolName } };
  }
  if (stepNumber === 0 && forceWebSearch) return { activeTools: without('webSearch') };
  if (stepNumber === 0) {
    return { activeTools: without('webSearch', 'searchKnowledgeBase') };
  }
  if (stepNumber === 1 && forceKnowledgeBaseSearch) {
    return { activeTools: without('searchKnowledgeBase', 'webSearch') };
  }
  if (stepNumber === 1 && forceWebSearch) {
    return { activeTools: without('webSearch') };
  }
  return { activeTools: without('webSearch', 'searchKnowledgeBase') };
}
