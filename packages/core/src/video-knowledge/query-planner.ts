export type VideoQuestionKind =
  | 'direct-speech'
  | 'exact-ocr'
  | 'visual-fact'
  | 'state-change'
  | 'comparison'
  | 'outcome'
  | 'counting'
  | 'computation';

export interface VideoQueryPlan {
  kinds: VideoQuestionKind[];
  modalities: Array<'transcript' | 'ocr' | 'visual' | 'computed'>;
  requiresBothRanges: boolean;
  requiresInspectionWhenInsufficient: boolean;
}

/**
 * Deterministic first-pass planner. Intent classification is based on
 * language-neutral structural cues and a minimal set of English keywords
 * (the most common query language). Retrieval itself is fully
 * language-neutral: every question searches all grounded projections,
 * and semantic/vector matching determines which evidence supports the answer
 * regardless of the source or query language.
 */
export function planVideoQuestion(question: string): VideoQueryPlan {
  const text = question.toLocaleLowerCase();
  const kinds = new Set<VideoQuestionKind>();

  // Structural / language-neutral cues.
  if (/\d+[\-:]\d+/.test(text)) kinds.add('outcome'); // Paired-value patterns: "2-1", "4:2"
  if (/\d+\s*[%$€£¥]/.test(text)) kinds.add('exact-ocr'); // Numeric values with units
  if (/https?:\/\//.test(text)) kinds.add('exact-ocr'); // URLs in question

  // English keyword hints (optimisation, not a language gate).
  if (/\b(?:say|said|quote|speak|mention)\b/.test(text)) kinds.add('direct-speech');
  if (/\b(?:text|code|url|version|written|screen)\b/.test(text)) kinds.add('exact-ocr');
  if (/\b(?:change|before|after|then|difference|versus|compare)\b/.test(text))
    kinds.add('state-change');
  if (/\b(?:compare|versus|vs\.?|difference)\b/.test(text)) kinds.add('comparison');
  if (/\b(?:final|conclusion|outcome|result|ending|ended|decided)\b/.test(text))
    kinds.add('outcome');
  if (/\b(?:how many|count|number of|percentage|largest)\b/.test(text)) kinds.add('counting');
  if (/\b(?:calculate|average|sum|percentage)\b/.test(text)) kinds.add('computation');

  if (kinds.size === 0) kinds.add('visual-fact');

  const modalities = new Set<VideoQueryPlan['modalities'][number]>([
    'transcript',
    'ocr',
    'visual',
    'computed',
  ]);
  return {
    kinds: [...kinds],
    modalities: [...modalities],
    requiresBothRanges: kinds.has('comparison') || kinds.has('state-change'),
    requiresInspectionWhenInsufficient:
      kinds.has('exact-ocr') || kinds.has('visual-fact') || kinds.has('counting'),
  };
}
