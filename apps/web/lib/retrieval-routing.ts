/**
 * Keeps retrieval routing deterministic before the chat model is asked to
 * decide whether a returned source is actually useful.
 */
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
    /\b(uploaded?|indexed|scraped|knowledge base|corpus)\b/i.test(normalized) ||
    /\bshow\s+me\b/i.test(normalized)
  );
}

/** Current/public questions should begin on the web unless they explicitly
 * refer to the user's indexed data, which the caller gives precedence to. */
export function requiresCurrentWebSearch(text: string): boolean {
  return /\b(?:search (?:the )?web|search online|look (?:it )?up|internet|latest|current|today|yesterday|breaking news|weather|stock price|exchange rate|election result|schedule|who won|winner|match result|final score)\b/i.test(
    text,
  );
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
  if (stepNumber === 0 && forceWebSearch) {
    return { toolChoice: { type: 'tool', toolName: 'webSearch' } };
  }
  if (stepNumber === 0) {
    return { activeTools: without('webSearch', 'searchKnowledgeBase') };
  }
  if (stepNumber === 1 && forceKnowledgeBaseSearch) {
    return { activeTools: without('searchKnowledgeBase') };
  }
  if (stepNumber === 1 && forceWebSearch) {
    return { activeTools: without('webSearch') };
  }
  return { activeTools: without('webSearch', 'searchKnowledgeBase') };
}
