export type VideoQuestionKind =
  | 'direct-speech'
  | 'exact-ocr'
  | 'visual-fact'
  | 'state-change'
  | 'comparison'
  | 'outcome'
  | 'counting'
  | 'computation'
  | 'person-attribute'
  | 'question-inventory'
  | 'activity-structure'
  | 'source-inventory'
  | 'entity-inventory'
  | 'evaluation'
  | 'coverage';

/** The data-engine operation that answers a question without relying on a model's recall. */
export type VideoQueryRoute = 'search' | 'temporal' | 'aggregate' | 'scan' | 'export';

/**
 * A language model's content-neutral statement of how a question should be
 * investigated. It describes evidence scope and operation, never a video
 * genre, language, subject, or vocabulary pattern.
 */
export interface VideoInvestigationDirective {
  /** One local moment, a relationship across moments, or the active source as a whole. */
  scope: 'focused' | 'temporal' | 'source';
  /** The evidence operation needed to answer, independently of subject matter. */
  goal: 'answer' | 'compare' | 'trace' | 'enumerate' | 'synthesize';
  /** Modalities the answer needs; omission keeps every available modality. */
  evidence?: Array<'speech' | 'visible-text' | 'visual' | 'computed'>;
  /** The evidence collection to enumerate when scope is the full source. */
  recordSet?: 'all' | 'source-authored' | 'source-questions' | 'observed';
  /**
   * A source range the conversational model resolved from the user's meaning.
   * The executor consumes numbers only; it never recognizes time expressions
   * from a particular human language.
   */
  timeRange?: { startSecs: number; endSecs: number };
}

export interface VideoQueryPlan {
  kinds: VideoQuestionKind[];
  route: VideoQueryRoute;
  modalities: Array<'transcript' | 'ocr' | 'visual' | 'computed'>;
  requiresBothRanges: boolean;
  requiresInspectionWhenInsufficient: boolean;
  requiresBroadCoverage: boolean;
  /** Kept for evidence consumers; identity comes only from grounded source records. */
  requiresIdentityContext: boolean;
  subjectName?: string;
  investigation: VideoInvestigationDirective;
}

const directiveScopes = new Set<VideoInvestigationDirective['scope']>([
  'focused',
  'temporal',
  'source',
]);
const directiveGoals = new Set<VideoInvestigationDirective['goal']>([
  'answer',
  'compare',
  'trace',
  'enumerate',
  'synthesize',
]);
const directiveModalities = new Set<NonNullable<VideoInvestigationDirective['evidence']>[number]>([
  'speech',
  'visible-text',
  'visual',
  'computed',
]);
const directiveRecordSets = new Set<NonNullable<VideoInvestigationDirective['recordSet']>>([
  'all',
  'source-authored',
  'source-questions',
  'observed',
]);

function requireDirective(directive: VideoInvestigationDirective): VideoInvestigationDirective {
  if (!directiveScopes.has(directive.scope) || !directiveGoals.has(directive.goal)) {
    throw new Error('Video investigation requires a valid, content-neutral directive.');
  }
  if (directive.recordSet && !directiveRecordSets.has(directive.recordSet)) {
    throw new Error('Video investigation requires a valid, content-neutral directive.');
  }
  const timeRange = directive.timeRange;
  if (
    timeRange &&
    (!Number.isFinite(timeRange.startSecs) ||
      !Number.isFinite(timeRange.endSecs) ||
      timeRange.startSecs < 0 ||
      timeRange.endSecs < timeRange.startSecs)
  ) {
    throw new Error('Video investigation requires a valid, content-neutral directive.');
  }
  const evidence = directive.evidence?.filter((item) => directiveModalities.has(item));
  return {
    scope: directive.scope,
    goal: directive.goal,
    ...(evidence && evidence.length > 0 ? { evidence: [...new Set(evidence)] } : {}),
    ...(directive.recordSet ? { recordSet: directive.recordSet } : {}),
    ...(timeRange
      ? { timeRange: { startSecs: timeRange.startSecs, endSecs: timeRange.endSecs } }
      : {}),
  };
}

/**
 * Turns an agent-supplied investigation intent into deterministic retrieval
 * operations. `question` deliberately is not read here: language and subject
 * understanding belongs to the model that created `directive`, while this
 * executor remains identical for every kind of video.
 */
export function planVideoQuestion(
  _question: string,
  directive: VideoInvestigationDirective,
): VideoQueryPlan {
  const investigation = requireDirective(directive);
  const evidence = investigation.evidence ?? ['speech', 'visible-text', 'visual', 'computed'];
  const modalities = [
    ...new Set(
      evidence.map((item) =>
        item === 'speech' ? 'transcript' : item === 'visible-text' ? 'ocr' : item,
      ),
    ),
  ] as VideoQueryPlan['modalities'];
  const kinds = new Set<VideoQuestionKind>();
  if (investigation.goal === 'answer') kinds.add('visual-fact');
  if (investigation.goal === 'compare') kinds.add('comparison');
  if (investigation.goal === 'trace') kinds.add('state-change');
  if (investigation.goal === 'enumerate' || investigation.goal === 'synthesize') {
    kinds.add('coverage');
  }
  if (
    investigation.scope === 'source' &&
    (investigation.recordSet === 'source-authored' ||
      investigation.recordSet === 'source-questions')
  ) {
    kinds.add('source-inventory');
  }
  if (investigation.scope === 'source') kinds.add('coverage');

  return {
    kinds: [...kinds],
    route:
      investigation.scope === 'source'
        ? investigation.goal === 'enumerate'
          ? 'scan'
          : 'aggregate'
        : investigation.scope === 'temporal'
          ? 'temporal'
          : 'search',
    modalities,
    requiresBothRanges:
      investigation.scope !== 'focused' ||
      investigation.goal === 'compare' ||
      investigation.goal === 'trace',
    requiresInspectionWhenInsufficient: true,
    requiresBroadCoverage: investigation.scope === 'source',
    requiresIdentityContext: false,
    investigation,
  };
}
