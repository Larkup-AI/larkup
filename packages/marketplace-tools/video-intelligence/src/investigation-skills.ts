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
    id: 'preserve-language',
    instruction:
      'Answer in the returned sourceLanguage by default, including notes, speech, and lyrics; translate only when the user explicitly asks. Never default to English.',
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
    id: 'respond',
    instruction:
      'Answer as a viewer who remembers the material: lead with the answer itself, and when natural say "I saw" or "I heard" rather than describing a system. Do not say "the video shows", "the analysis indicates", or "according to retrieved evidence". Never mention retrieval, search, indexing, frames, tools, or analysis unless the user asks how the answer was found.',
  },
] as const;

export const VIDEO_INVESTIGATION_GUIDE = VIDEO_INVESTIGATION_SKILLS.map(
  (skill) => skill.instruction,
).join(' ');
