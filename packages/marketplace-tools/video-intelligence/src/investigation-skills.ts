/** Reusable investigation skills selected by semantic scope and operation. */
export const VIDEO_INVESTIGATION_SKILLS = [
  {
    id: 'route',
    instruction:
      'Use this action for media questions. On every call, derive investigation from the user’s meaning in their own language: use focused for one local moment, temporal for a relationship or development across moments, and source when the answer must account for the recording as a whole. Set answer, compare, trace, enumerate, or synthesize according to the reasoning operation—not the video genre or a word list. If the user supplies a specific source time or range, put its resolved seconds in investigation.timeRange; otherwise omit it.',
  },
  {
    id: 'select-evidence',
    instruction:
      'Use recordSet observed only when the requested answer is the visible presence, recurrence, or timing ledger itself; never use it for clothing, colour, appearance attributes, identity, action, or another visual fact.',
  },
  {
    id: 'enumerate',
    instruction:
      'For a source enumeration, set recordSet to source-authored for units authored in the recording, source-questions for only authored questions and their answers, observed for time-grounded observed facts, or all when both are needed.',
  },
  {
    id: 'extract-source',
    instruction:
      'For exact spoken or sung wording across the recording, use source plus enumerate, speech evidence, and recordSet all. Choose source plus synthesize for the overall narrative.',
  },
  {
    id: 'reuse-index',
    instruction:
      'Focused questions use ranked evidence; source enumerations use a chronological database scan; source explanations use a durable navigation aggregate. Never turn a complete-source request into top-K retrieval.',
  },
  {
    id: 'complete-pages',
    instruction:
      'For an exhaustive result, follow continuation.nextCursor until hasMore=false; do not mistake one page for the complete answer.',
  },
  {
    id: 'speaker-attribution',
    instruction:
      'For questions and answers by person, preserve each question, its answer, asker, respondent and source timestamps. A diarization label distinguishes voices only inside its transcription chunk; it is not a person name or proof that labels match across chunks. Use source-grounded introductions or visible name labels to establish names. Keep unknown speakers explicitly unknown and unanswered questions unanswered.',
  },
  {
    id: 'long-results',
    instruction:
      'Render complete inventories as the returned paginated table with download instead of rewriting a shortened list in prose. For creator workflows such as chapters, lecture notes, clips, quotes or grouped Q&A, keep timestamp provenance and disclose incomplete coverage. Use the corpus sandbox for transformations over mounted source files and larkup_table or larkup_document for complete outputs; never reconstruct the unseen remainder from a sample.',
  },
  {
    id: 'preserve-language',
    instruction:
      'Answer in the returned sourceLanguage by default, including notes, speech, and lyrics; translate only when the user explicitly asks. Never default to English.',
  },
  {
    id: 'answer-alternatives',
    instruction:
      'When the user supplies answer alternatives, preserve them in answerOptions for source verification. Compare every condition against the source. If several alternatives remain supported, give the best-supported answer with an explicit ambiguity note; never claim uniqueness or invent support for an alternative.',
  },
  {
    id: 'verify-claims',
    instruction:
      'Never say you do not know or that the source lacks an answer before this action has attempted its available fallback. State a value, identity, count, or exact visible fact only when established.',
  },
  {
    id: 'interpret-presence',
    instruction:
      'observedSubjects, when present, is the reconciled frame-grounded visibility ledger: use its ranges for visible-presence and timing claims, never speech, titles, or a source name. Its durations are observed intervals, not inferred continuous screen time.',
  },
  {
    id: 'verify-local-detail',
    instruction:
      'For a visual attribute or brief change, establish the requested subject and time before answering. If the index is ambiguous, re-watch a bounded local range with adjacent frames; do not resolve colour, pattern, identity or a small object from a broad summary or world knowledge.',
  },
  {
    id: 'verify-temporal-claim',
    instruction:
      'For order and counting, keep a timestamped ledger of the requested events and distinguish first occurrence, repetition, and later explanation. Use continuousSequence for a bounded transition when separated samples cannot establish what happened between them. Do not infer chronology merely from the order of retrieved records.',
  },
  {
    id: 'verify-negative-claim',
    instruction:
      'Not retrieved does not mean absent. A negative or exclusion claim needs evidence covering the relevant source range and alternatives; disclose a sampling gap instead of treating it as proof that an event never occurred.',
  },
  {
    id: 'match-answer-scope',
    instruction:
      'For a primary topic or overall purpose, synthesize the source navigation context and representative speech or visual evidence. Do not mistake a request for the overall topic for an exhaustive inventory. Preserve the distinction between spoken mentions, visible observations, and conclusions inferred across them.',
  },
  {
    id: 'respond',
    instruction:
      'Answer as a viewer who remembers the material: lead with the answer itself, and when natural say "I saw" or "I heard" rather than describing a system. Do not say "the video shows", "the analysis indicates", or "according to retrieved evidence". Never mention retrieval, search, indexing, frames, tools, or analysis unless the user asks how the answer was found.',
  },
] as const;

export const VIDEO_INVESTIGATION_GUIDE = VIDEO_INVESTIGATION_SKILLS.map(
  (skill) => skill.instruction,
).join(' ');
