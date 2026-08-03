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

/** The chat workspace is intentionally a retrieval-only experience. */
export function requiresCurrentWebSearch(text: string): boolean {
  void text;
  return false;
}

/** Only the first retrieval is forced. The other source remains available for
 * exactly one recovery attempt; subsequent steps are reserved for analysis and
 * the final answer. */
export function retrievalToolsForStep(options: {
  stepNumber: number;
  forceKnowledgeBaseSearch: boolean;
  forceWebSearch: boolean;
  toolNames: string[];
}): { toolChoice?: { type: 'tool'; toolName: string }; activeTools?: string[] } | undefined {
  const { stepNumber, forceKnowledgeBaseSearch, forceWebSearch, toolNames } = options;
  const without = (...blocked: string[]) => toolNames.filter((name) => !blocked.includes(name));

  if (stepNumber === 0 && forceKnowledgeBaseSearch) {
    return { toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' } };
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
