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
  | 'source-inventory'
  | 'entity-inventory'
  | 'evaluation'
  | 'coverage';

export interface VideoQueryPlan {
  kinds: VideoQuestionKind[];
  modalities: Array<'transcript' | 'ocr' | 'visual' | 'computed'>;
  requiresBothRanges: boolean;
  requiresInspectionWhenInsufficient: boolean;
  /** The answer must represent the source broadly, not one highly ranked moment. */
  requiresBroadCoverage: boolean;
  /** The answer names or distinguishes people, so an identity anchor may sit elsewhere in the source. */
  requiresIdentityContext: boolean;
  /**
   * A named individual the question is about. When present, the caller should first locate a transcript
   * mention of this exact name to ground *which* visible person is being
   * asked about, instead of asking for a description of the whole scene.
   */
  subjectName?: string;
}

// Common words that sit next to an appearance/action verb without being a
// person's name -- filtered out of subjectName extraction.
const SUBJECT_NAME_STOPWORDS = new Set([
  'what',
  'who',
  'where',
  'when',
  'why',
  'how',
  'is',
  'was',
  'are',
  'were',
  'does',
  'did',
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'this',
  'that',
  'it',
  'he',
  'she',
  'they',
  'someone',
  'person',
  'persons',
  'people',
  'man',
  'men',
  'woman',
  'women',
  'guy',
  'guys',
  'individual',
  'individuals',
  'everyone',
  'everybody',
  'anybody',
  'anyone',
  'nobody',
  'both',
  'each',
  'all',
  'member',
  'members',
  'participant',
  'participants',
  'player',
  'players',
  'team',
  'teams',
  'group',
  'groups',
  'side',
  'sides',
  'panel',
  'list',
  'me',
  'us',
  'you',
  'him',
  'her',
  'them',
  'one',
  'ones',
  'other',
  'others',
]);

const PERSON_ATTRIBUTE_VERBS =
  '(?:wear\\w*|dress\\w*|hold\\w*|carr\\w*|do|does|did|doing|done|stand\\w*|sit\\w*|driv\\w*|eat\\w*|drink\\w*|say\\w*|talk\\w*)';
const ATTRIBUTE_VERB = new RegExp(`\\b${PERSON_ATTRIBUTE_VERBS}\\b`, 'iu');

function lastWordBefore(question: string, index: number) {
  const prefix = question.slice(0, index).trim();
  const match = prefix.match(/[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}'-]{0,30}$/u);
  return match?.[0];
}

function subjectAfterAction(question: string, index: number) {
  const suffix = question.slice(index).trim();
  // "talking to Sara" identifies someone; "wearing a red shirt" does not.
  const match = suffix.match(
    /^(?:to|with|at|by|from)\s+([\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}'-]{0,30})/iu,
  );
  return match?.[1];
}

/** Extracts a named-person subject from a question, if one is plausibly there. */
function extractSubjectName(question: string): string | undefined {
  const match = ATTRIBUTE_VERB.exec(question);
  if (!match || match.index === undefined) return undefined;
  const before = lastWordBefore(question, match.index);
  const candidate =
    before && !SUBJECT_NAME_STOPWORDS.has(before.toLocaleLowerCase())
      ? before
      : subjectAfterAction(question, match.index + match[0].length);
  if (!candidate || SUBJECT_NAME_STOPWORDS.has(candidate.toLocaleLowerCase())) return undefined;
  return candidate;
}

/**
 * Deterministic first-pass planner. It classifies the *shape* of a question --
 * does it need one fact, an ordered account, a comparison, a count, or the
 * whole source -- from structural cues and interrogatives that carry the same
 * meaning in any subject matter. It deliberately contains no vocabulary from
 * any particular kind of video; every source routes through the same rules.
 *
 * Classification only widens or narrows how much evidence the agent gathers.
 * Retrieval itself is language-neutral: every question searches all grounded
 * projections, and semantic matching decides which evidence supports the
 * answer regardless of the source or query language.
 */
export function planVideoQuestion(question: string): VideoQueryPlan {
  const text = question.normalize('NFKC').toLocaleLowerCase();
  const kinds = new Set<VideoQuestionKind>();

  // Structural cues that carry the same meaning in any language.
  if (/\d+\s*[-:]\s*\d+/.test(text)) kinds.add('exact-ocr'); // A displayed paired value.
  if (/\d+\s*[%$€£¥]|[%$€£¥]\s*\d+/.test(text)) kinds.add('exact-ocr');
  if (/https?:\/\//.test(text)) kinds.add('exact-ocr');

  // Interrogatives and generic task verbs. These describe what the asker wants
  // done with the source, never what the source is about.
  const asksWho =
    /\b(?:who|whom|whose)\b/.test(text) ||
    /(?:^|\s)(?:مين|من هو|من هي|من الذي|من التي|من)(?:\s|$|؟)/u.test(text);
  const asksQuote =
    /\b(?:say|said|says|quote|quoted|speak|spoke|spoken|mention|mentioned|announce|announced|state[ds]?)\b/.test(
      text,
    ) || /(?:قال|قالت|قالوا|ذكر|ذكرت|نطق|تحدث|صرح|اقتباس)/u.test(text);
  const asksVisibleText =
    /\b(?:text|caption|subtitle|label|sign|code|url|version|written|writing|display(?:ed|s)?|screen|on-screen|shown\s+text)\b/.test(
      text,
    ) || /(?:النص|المكتوب|مكتوب|الشاشة|اللافتة|العنوان المكتوب)/u.test(text);
  const asksOrder =
    /\b(?:timeline|chronolog\w*|sequence|order|progression|steps?|stages?|phases?|history|over\s+time|one\s+by\s+one|change[ds]?|changing|before\s+and\s+after|first.*then|earlier.*later)\b/.test(
      text,
    ) ||
    /(?:تسلسل|ترتيب|بالترتيب|مراحل|خطوات|تطور|على مدار|واحد ورا التاني|التغير|التغيرات)/u.test(
      text,
    );
  const asksCompare =
    /\b(?:compare|compared|comparison|versus|vs\.?|difference|differ\w*|contrast|which\s+(?:one|of)|between\s+\w+\s+and)\b/.test(
      text,
    ) || /(?:قارن|مقارنة|الفرق|مقابل|ايهما|أيهما|بين .* و)/u.test(text);
  const hasExplicitAlternatives =
    /\b(?:versus|vs\.?|against)\b/.test(text) || /(?:ضد|مقابل)/u.test(text);
  const terseIdentityResolution =
    asksWho &&
    ((text.match(/[\p{Letter}\p{Number}]+/gu)?.length ?? 0) <= 3 || hasExplicitAlternatives) &&
    !asksQuote &&
    !ATTRIBUTE_VERB.test(text);
  // "Which of these" asks the source to resolve between alternatives, exactly
  // as "who" does. Treating it as an ordinary description is what let a
  // question whose answer sits in a closing state be answered from an
  // arbitrary mid-source moment instead.
  const asksSelection =
    /\b(?:which|whichever)\b/.test(text) ||
    /(?:^|\s)(?:أي|أيّ|اي|ايهما|أيهما|مين فيهم)(?:\s|$|؟)/u.test(text);
  // Resolution verbs: a contest, a vote, a negotiation, a case, and a game all
  // conclude with one side prevailing. This is the shape of the question, not
  // the subject matter of any particular kind of source.
  const asksResolution =
    /\b(?:won|win|wins|winner|winning|lost|lose|loses|loser|beat|beaten|defeat(?:ed|s)?|prevail(?:ed|s)?|champion|runner-?up|qualif\w*|eliminat\w*|advanc\w*)\b/.test(
      text,
    ) ||
    /(?:فاز|فازت|يفوز|الفائز|الفايز|كسب|كسبت|يكسب|خسر|خسرت|الخاسر|غلب|تغلب|انتصر|بطل|البطل|اتأهل|تأهل)/u.test(
      text,
    );
  const asksConclusion =
    terseIdentityResolution ||
    asksResolution ||
    (asksSelection && /\b(?:match|game|round|contest|race|vote|case|deal)\b/.test(text)) ||
    /\b(?:final|finally|conclusion|conclude[ds]?|outcome|result(?:ed|s)?|end|ends|ending|ended|decided|decision|verdict|resolved|settled)\b/.test(
      text,
    ) ||
    /(?:النتيجة|النتائج|النهاية|النهائي|في الآخر|في النهاية|انتهت|انتهى|القرار|الحكم|الخلاصة)/u.test(
      text,
    );
  const asksCount =
    /\b(?:how\s+many|how\s+much|count|number\s+of|total|amount\s+of|times|frequency|most|largest|smallest|longest|shortest)\b/.test(
      text,
    ) || /(?:كم|كام|عدد|إجمالي|اجمالي|مرات|أكثر|اكثر|أكبر|اكبر|أصغر|اطول|أطول)/u.test(text);
  const asksComputation =
    /\b(?:calculate|calculated|average|mean|sum|total\s+of|percentage|ratio|rate|per\s+\w+)\b/.test(
      text,
    ) || /(?:احسب|المتوسط|المجموع|النسبة|معدل)/u.test(text);
  const asksEvaluation =
    /\b(?:most|least|best|worst|more|less)\s+(?:effective|active|involved|engaged|helpful|important|influential|impactful)|\b(?:contribut\w*|participat\w*|interact\w*|spoke|talked|shared)\s+(?:the\s+)?most\b|\b(?:most|least)\s+(?:contribut\w*|participat\w*|interact\w*|speaking|talking|sharing)\b/.test(
      text,
    ) ||
    /(?:الأكثر|الاكثر|اكتر|أكتر).{0,30}(?:فعالية|فاعلية|مشاركة|تأثير|تفاعلا|تفاعل|كلاما|كلام)|(?:شارك|ساهم|تكلم|اتكلم).{0,20}(?:أكثر|اكتر|الأكثر|الاكثر)/u.test(
      text,
    );

  if (asksQuote) kinds.add('direct-speech');
  if (asksVisibleText) kinds.add('exact-ocr');
  if (asksOrder) kinds.add('state-change');
  if (asksCompare || (asksSelection && asksResolution)) kinds.add('comparison');
  if (asksConclusion) kinds.add('outcome');
  if (asksCount) kinds.add('counting');
  if (asksComputation) kinds.add('computation');
  if (asksEvaluation) kinds.add('evaluation');

  // A request to represent the *whole* source rather than its best-matching
  // moment. Either an explicit whole-source quantifier, or a summarise/list
  // task with no narrowing qualifier.
  const wholeSourceQuantifier =
    /\b(?:all|every|each|entire|whole|complete(?:ly)?|full|throughout|overall)\b/.test(text) ||
    /(?:كل|كافة|جميع|كامل|بالكامل|بأكمله|طوال|إجمالا)/u.test(text);
  const representationTask =
    /\b(?:summar(?:y|ise|ize|ised|ized)|overview|recap|outline|walk\s+me\s+through|list|enumerate|cover|breakdown|content|topics?|agenda|main\s+points?|key\s+points?)\b/.test(
      text,
    ) || /(?:لخص|ملخص|تلخيص|نظرة عامة|اسرد|اذكر|محتوى|مواضيع|موضوعات|النقاط|العناصر)/u.test(text);
  const broadCoverage =
    asksEvaluation ||
    (wholeSourceQuantifier && representationTask) ||
    (representationTask && /\b(?:video|recording|source|it|this)\b/.test(text)) ||
    (wholeSourceQuantifier && asksOrder) ||
    /(?:لخص|ملخص|تلخيص).{0,20}(?:الفيديو|التسجيل|المصدر)/u.test(text);
  if (broadCoverage) kinds.add('coverage');
  const asksQuestionInventory =
    wholeSourceQuantifier &&
    (/\b(?:questions?|prompts?|queries)\b/.test(text) ||
      /(?:الأسئلة|الاسئلة|الأسئله|الاسئله|كل\s+سؤال)/u.test(text));
  if (asksQuestionInventory) kinds.add('question-inventory');
  const asksSourceInventory =
    wholeSourceQuantifier &&
    (/\b(?:slides?|boards?|whiteboards?|headings?|titles?|bullets?|written|writing|displayed\s+(?:items?|content)|on-screen\s+(?:items?|content))\b/.test(
      text,
    ) ||
      /(?:الشرائح|السلايدز|السبورة|اللوح|العناوين|النقاط|كل\s+ما\s+(?:كتب|كُتب|ظهر)|المكتوب)/u.test(
        text,
      ));
  if (asksSourceInventory) kinds.add('source-inventory');

  // Plural appearance questions require evidence for more than one visible
  // subject even when the user did not explicitly say "compare".
  const pluralVisualComparison =
    /\b(?:are|were|do|did|they|them|both|everyone)\b[^?.!]{0,80}\b(?:wear\w*|dress\w*|look\w*|appear\w*|hold\w*)\b/.test(
      text,
    ) ||
    /\b(?:wear\w*|dress\w*|look\w*|appear\w*|hold\w*)\b[^?.!]{0,80}\b(?:they|them|both|everyone)\b/.test(
      text,
    );
  // A distributive request asks for one attribute per subject, even when it
  // uses a singular pronoun (for example, "each one ... he was wearing").
  // That is a multi-subject relation, not one generic scene caption.
  const distributiveVisualAttribute =
    ATTRIBUTE_VERB.test(text) &&
    (/\b(?:each|every|all|both|everyone|everybody|individuals?|people|persons?|participants?|members?|players?|one\s+by\s+one)\b/.test(
      text,
    ) ||
      /(?:كل(?:هم| واحد)?|واحد\s+واحد|كل\s+شخص|كل\s+لاعب|كل\s+مشارك)/u.test(text));
  if (pluralVisualComparison || distributiveVisualAttribute) {
    kinds.add('comparison');
    kinds.add('person-attribute');
  }

  // A named answer or a per-subject attribute needs identity anchors, which
  // can live in a title card, roster, caption, or introduction far from the
  // visual attribute itself.
  const requiresIdentityContext =
    asksWho ||
    distributiveVisualAttribute ||
    /\b(?:name[ds]?|names|identity|identified|people|persons?|participants?|players?|members?|speakers?|presenters?|guests?|attendees?|author|by\s+whom)\b/.test(
      text,
    ) ||
    /(?:اسم|أسماء|الاسم|هوية|الأشخاص|الاشخاص|المشاركين|اللاعبين|الأعضاء|الاعضاء|الضيوف|المتحدثين|المقدم|صاحب)/u.test(
      text,
    );
  const asksEntityInventory =
    requiresIdentityContext &&
    (representationTask || (asksWho && wholeSourceQuantifier)) &&
    (/\b(?:name|names|identity|identities|participants?|speakers?|presenters?|attendees?|people|persons?)\b/.test(
      text,
    ) ||
      /(?:اسم|أسماء|الاسم|هوية|المشاركين|المتحدثين|الحاضرين|الأشخاص|الاشخاص)/u.test(text));
  if (asksEntityInventory) kinds.add('entity-inventory');

  // Uses the original question so names in any script and informal lower-case
  // phrasing can become a retrieval anchor.
  const subjectName = extractSubjectName(question);
  if (subjectName) kinds.add('person-attribute');

  if (kinds.size === 0) kinds.add('visual-fact');

  return {
    kinds: [...kinds],
    modalities: ['transcript', 'ocr', 'visual', 'computed'],
    requiresBothRanges:
      kinds.has('comparison') || kinds.has('state-change') || kinds.has('coverage'),
    requiresBroadCoverage: broadCoverage,
    requiresIdentityContext,
    requiresInspectionWhenInsufficient:
      kinds.has('exact-ocr') ||
      kinds.has('visual-fact') ||
      kinds.has('counting') ||
      kinds.has('outcome') ||
      kinds.has('state-change') ||
      kinds.has('comparison') ||
      kinds.has('person-attribute') ||
      kinds.has('entity-inventory') ||
      kinds.has('evaluation'),
    ...(subjectName ? { subjectName } : {}),
  };
}
