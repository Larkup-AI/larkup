type ToolResultPart = {
  type?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  [key: string]: unknown;
};

/**
 * Interpret the generic media-evidence verification protocol.
 *
 * `directlyEstablished` describes whether one observation states the answer.
 * It is deliberately false for an answer established by a chronological trail,
 * which is still answer-level evidence and must not be downgraded to a refusal.
 */
export function mediaClaimNeedsCorroboration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const verification = value as {
    status?: unknown;
    directlyEstablished?: unknown;
    requiresCorroboration?: unknown;
  };
  if (verification.status === 'needs-corroboration') return true;
  if (
    verification.status === 'directly-established' ||
    verification.status === 'established-by-trail'
  ) {
    return false;
  }
  if (typeof verification.requiresCorroboration === 'boolean') {
    return verification.requiresCorroboration;
  }
  // Backward compatibility for evidence providers that predate `status`.
  return verification.directlyEstablished === false;
}

/** True when the evidence provider says the claim can be answered now. */
export function mediaClaimIsAnswerLevel(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const verification = value as {
    status?: unknown;
    directlyEstablished?: unknown;
    requiresCorroboration?: unknown;
  };
  if (
    verification.status === 'directly-established' ||
    verification.status === 'established-by-trail'
  ) {
    return true;
  }
  if (verification.status === 'needs-corroboration') return false;
  if (verification.requiresCorroboration === true) return false;
  return verification.directlyEstablished === true;
}

/** Find an answer-level media claim even when it is nested in a search result. */
export function containsAnswerLevelMediaEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return containsAnswerLevelMediaEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsAnswerLevelMediaEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (
    record.success === true &&
    mediaClaimIsAnswerLevel(record.claimVerification) &&
    (Array.isArray(record.evidence) || record.directObservation !== undefined)
  ) {
    return true;
  }
  return Object.values(record).some(containsAnswerLevelMediaEvidence);
}

function questionSimilarity(left: string, right: string) {
  const terms = (value: string) =>
    new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{Letter}\p{Number}]+/gu) ?? [],
    );
  const leftTerms = terms(left);
  const rightTerms = terms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const weight = (values: Set<string>) =>
    [...values].reduce((total, term) => total + term.length, 0);
  const shared = new Set([...leftTerms].filter((term) => rightTerms.has(term)));
  return weight(shared) / Math.max(weight(leftTerms), weight(rightTerms));
}

/** Extract only direct claims verified for the current question. */
export function collectQuestionMatchedDirectClaims(value: unknown, question: string): string[] {
  const claims = new Set<string>();
  const inspectText = (text: string) => {
    for (const block of text.split(/(?=Claim question:)/gi)) {
      const claimedQuestion = block.match(/Claim question:\s*([^\n]+)/i)?.[1]?.trim();
      const answer = block.match(/Claim answer:\s*([^\n]+)/i)?.[1]?.trim();
      if (
        claimedQuestion &&
        answer &&
        /Claim verdict:\s*direct/i.test(block) &&
        questionSimilarity(claimedQuestion, question) >= 0.55
      ) {
        claims.add(answer);
      }
    }
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') return inspectText(candidate);
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (candidate && typeof candidate === 'object') Object.values(candidate).forEach(visit);
  };
  visit(value);
  return [...claims].slice(0, 8);
}

/**
 * Last-resort visible text when a provider closes after tools without writing
 * its answer. Only answer-level media results qualify; locators and
 * needs-corroboration results must never be turned into claims here.
 */
export function collectAnswerLevelMediaStatements(value: unknown): string[] {
  const statements: string[] = [];
  const seen = new Set<string>();
  let exhaustive = false;
  const textOf = (payload: unknown) => {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* ordinary text is not a verified media result */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (
      record.continuation &&
      typeof record.continuation === 'object' &&
      (record.continuation as { exhaustive?: unknown }).exhaustive === true
    ) {
      exhaustive = true;
    }
    if (
      record.success === true &&
      mediaClaimIsAnswerLevel(record.claimVerification) &&
      Array.isArray(record.evidence)
    ) {
      for (const item of record.evidence as Array<{ payload?: unknown }>) {
        const sourceText = textOf(item?.payload);
        // Individual source readings can explicitly state that they are only
        // partial context. A top-level scan being complete does not upgrade a
        // partial reading into an answer to a different question.
        if (
          /^Observed context \(not a complete answer\):/i.test(sourceText.trim()) ||
          /\nClaim verdict:\s*(?:partial|not-established)\b/i.test(sourceText)
        ) {
          continue;
        }
        const statement = sourceText
          .split(/\nClaim question:/i, 1)[0]
          .replace(/^(?:Reconciled|Indexed)\s+(?:state|event|context|overview):\s*/i, '')
          .trim()
          .slice(0, 700);
        const key = statement.normalize('NFKC').toLocaleLowerCase();
        if (!statement || seen.has(key)) continue;
        seen.add(key);
        statements.push(statement);
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return exhaustive ? statements.slice(0, 2_000) : statements.slice(-8);
}

/**
 * Collect the visibility protocol without trying to interpret the user's
 * language. The reply model receives this separately from ranked snippets so
 * a direct re-watch of one moment cannot hide the reconciled recurrence data.
 */
export function collectObservedSubjectLedger(value: unknown): string[] {
  type Appearance = { startSecs: number; endSecs: number };
  const lines = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* ordinary text is not a structured evidence result */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success === true && mediaClaimIsAnswerLevel(record.claimVerification)) {
      const observedSubjects = record.observedSubjects;
      if (!Array.isArray(observedSubjects)) return;
      for (const subject of observedSubjects) {
        if (!subject || typeof subject !== 'object') continue;
        const identity =
          typeof (subject as { identity?: unknown }).identity === 'string'
            ? (subject as { identity: string }).identity.trim()
            : '';
        const identityBasis =
          typeof (subject as { identityBasis?: unknown }).identityBasis === 'string'
            ? (subject as { identityBasis: string }).identityBasis.trim()
            : '';
        const appearances = Array.isArray((subject as { appearances?: unknown }).appearances)
          ? (subject as { appearances: unknown[] }).appearances
              .map((appearance) => {
                if (!appearance || typeof appearance !== 'object') return undefined;
                const startSecs = Number((appearance as { startSecs?: unknown }).startSecs);
                const endSecs = Number((appearance as { endSecs?: unknown }).endSecs);
                return Number.isFinite(startSecs) &&
                  Number.isFinite(endSecs) &&
                  endSecs >= startSecs
                  ? ({ startSecs, endSecs } satisfies Appearance)
                  : undefined;
              })
              .filter((appearance): appearance is Appearance => Boolean(appearance))
          : [];
        if (!identity || !identityBasis || appearances.length === 0) continue;
        lines.add(
          `Reconciled visible subject: ${identity}\n` +
            `Identity basis: ${identityBasis}\n` +
            `Observed appearances: ${appearances
              .map((appearance) => `${appearance.startSecs}-${appearance.endSecs}s`)
              .join('; ')}`,
        );
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...lines].slice(0, 200);
}

/**
 * Render a source-position-to-recurrence answer when the local visual subject
 * is described but not named. This protocol guard prevents a prose model from
 * borrowing a proper name from another timestamp and attaching it to the
 * requested moment.
 */
export function formatLocatedObservedSubjectAnswer(value: unknown): string | undefined {
  type Appearance = { startSecs: number; endSecs: number };
  type Subject = {
    identity: string;
    identityBasis: string;
    appearances: Appearance[];
  };
  type LocalSubject = Subject & { localAppearance: Appearance };
  type LocatedSubject = LocalSubject & { directClaim?: string };
  const localSubjects: LocatedSubject[] = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured media evidence establishes this protocol */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success !== true || !mediaClaimIsAnswerLevel(record.claimVerification)) {
      Object.values(record).forEach(visit);
      return;
    }
    const directive = (record.investigation as { directive?: unknown } | undefined)?.directive as
      { scope?: unknown; recordSet?: unknown; timeRange?: unknown } | undefined;
    const requestedRange = directive?.timeRange as
      { startSecs?: unknown; endSecs?: unknown } | undefined;
    const startSecs = Number(requestedRange?.startSecs);
    const endSecs = Number(requestedRange?.endSecs);
    if (
      directive?.scope !== 'temporal' ||
      directive.recordSet !== 'observed' ||
      !Number.isFinite(startSecs) ||
      !Number.isFinite(endSecs) ||
      endSecs < startSecs ||
      !Array.isArray(record.evidence) ||
      !Array.isArray(record.observedSubjects)
    ) {
      return;
    }
    const ledger = (record.observedSubjects as unknown[])
      .map((item): Subject | undefined => {
        if (!item || typeof item !== 'object') return undefined;
        const identity =
          typeof (item as { identity?: unknown }).identity === 'string'
            ? (item as { identity: string }).identity.trim()
            : '';
        const identityBasis =
          typeof (item as { identityBasis?: unknown }).identityBasis === 'string'
            ? (item as { identityBasis: string }).identityBasis.trim()
            : '';
        const appearances = Array.isArray((item as { appearances?: unknown }).appearances)
          ? (item as { appearances: unknown[] }).appearances
              .map((appearance): Appearance | undefined => {
                if (!appearance || typeof appearance !== 'object') return undefined;
                const startSecs = Number((appearance as { startSecs?: unknown }).startSecs);
                const endSecs = Number((appearance as { endSecs?: unknown }).endSecs);
                return Number.isFinite(startSecs) &&
                  Number.isFinite(endSecs) &&
                  endSecs >= startSecs
                  ? { startSecs, endSecs }
                  : undefined;
              })
              .filter((appearance): appearance is Appearance => Boolean(appearance))
          : [];
        return identity && identityBasis && appearances.length > 0
          ? { identity, identityBasis, appearances }
          : undefined;
      })
      .filter((subject): subject is Subject => Boolean(subject));
    for (const item of record.evidence as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const payload = (item as { payload?: unknown }).payload;
      const text =
        typeof payload === 'string'
          ? payload
          : payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as { text?: unknown }).text
            : undefined;
      if (typeof text !== 'string') continue;
      const encoded = text.match(/^Visible subject:\s*(\{.+\})$/imu)?.[1];
      if (!encoded) continue;
      try {
        const parsed = JSON.parse(encoded) as {
          identity?: unknown;
          identityBasis?: unknown;
          startMs?: unknown;
          endMs?: unknown;
        };
        const identity = typeof parsed.identity === 'string' ? parsed.identity.trim() : '';
        const identityBasis =
          typeof parsed.identityBasis === 'string' ? parsed.identityBasis.trim() : '';
        const localStartSecs = Number(parsed.startMs) / 1_000;
        const localEndSecs = Number(parsed.endMs) / 1_000;
        if (
          !identity ||
          !['source-described', 'unresolved'].includes(identityBasis) ||
          !Number.isFinite(localStartSecs) ||
          !Number.isFinite(localEndSecs) ||
          localEndSecs < localStartSecs ||
          localStartSecs > endSecs ||
          localEndSecs < startSecs
        ) {
          continue;
        }
        const matched = ledger.find(
          (subject) => subject.identity === identity && subject.identityBasis === identityBasis,
        );
        localSubjects.push({
          identity,
          identityBasis,
          appearances: matched?.appearances ?? [
            { startSecs: localStartSecs, endSecs: localEndSecs },
          ],
          localAppearance: { startSecs: localStartSecs, endSecs: localEndSecs },
          ...(text.match(/\nClaim answer:\s*([^\n]+)/i)?.[1]?.trim()
            ? { directClaim: text.match(/\nClaim answer:\s*([^\n]+)/i)![1]!.trim() }
            : {}),
        });
      } catch {
        /* a malformed protocol record cannot produce a deterministic answer */
      }
    }
  };
  visit(value);
  const subject = localSubjects[0];
  if (!subject) return undefined;
  const formatTime = (seconds: number) => displayTimecode(seconds);
  const uniqueAppearances = subject.appearances.filter(
    (appearance, index, appearances) =>
      index === 0 ||
      appearance.startSecs !== appearances[index - 1]?.startSecs ||
      appearance.endSecs !== appearances[index - 1]?.endSecs,
  );
  const ranges = uniqueAppearances
    .map((appearance) =>
      appearance.endSecs > appearance.startSecs
        ? `${formatTime(appearance.startSecs)}–${formatTime(appearance.endSecs)}`
        : formatTime(appearance.startSecs),
    )
    .join(', ');
  const separatelyDescribed = localSubjects.filter(
    (candidate) =>
      candidate.identity !== subject.identity || candidate.identityBasis !== subject.identityBasis,
  );
  const separateLabels = separatelyDescribed
    .map((candidate) => {
      const appearances = candidate.appearances
        .map((appearance) =>
          appearance.endSecs > appearance.startSecs
            ? `${formatTime(appearance.startSecs)}–${formatTime(appearance.endSecs)}`
            : formatTime(appearance.startSecs),
        )
        .join(', ');
      return `${candidate.identity} (${candidate.identityBasis}) at ${appearances}`;
    })
    .join('; ');
  const identityBasisArticle = /^[aeiou]/i.test(subject.identityBasis) ? 'an' : 'a';
  return (
    (subject.directClaim ? `${subject.directClaim} ` : '') +
    `I saw ${subject.identity} at ${formatTime(subject.localAppearance.startSecs)}–${formatTime(
      subject.localAppearance.endSecs,
    )}. ` +
    `This is ${identityBasisArticle} ${subject.identityBasis} identification, so I cannot safely equate it with a separately named appearance. ` +
    `The recorded interval${uniqueAppearances.length === 1 ? '' : 's'} for this exact description: ${ranges}.` +
    (separateLabels
      ? ` The source also uses separate visible-subject labels: ${separateLabels}. It does not establish that those labels are the same identity.`
      : '')
  );
}

/**
 * Render a repeated visual appearance directly from the evidence protocol.
 * This is intentionally protocol-driven: a subject can be a person, animal,
 * object, character, or anything else the visual index describes.  It avoids
 * asking a prose model to reinterpret explicit discrete moments as one
 * continuous appearance or as an absence claim.
 */
export function formatObservedAppearanceAnswer(value: unknown): string | undefined {
  type Appearance = { startSecs: number; endSecs: number };
  type Subject = { identity: string; basis: string; appearances: Appearance[] };
  const subjects = new Map<string, Subject>();
  const textOf = (payload: unknown) => {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  };
  const parseAppearances = (line: string): Appearance[] => {
    const milliseconds = [...line.matchAll(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)ms\b/gu)].map(
      (match) => ({ startSecs: Number(match[1]) / 1_000, endSecs: Number(match[2]) / 1_000 }),
    );
    if (milliseconds.length > 0) return milliseconds;
    return [...line.matchAll(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s\b/gu)].map((match) => ({
      startSecs: Number(match[1]),
      endSecs: Number(match[2]),
    }));
  };
  const addEvidence = (evidence: unknown) => {
    if (!Array.isArray(evidence)) return;
    for (const item of evidence) {
      if (!item || typeof item !== 'object') continue;
      const text = textOf((item as { payload?: unknown }).payload);
      const match = text.match(
        /^Reconciled visible subject:\s*([^\n]+)\nIdentity basis:\s*([^\n]+)\nObserved appearances:\s*([^\n]+)/im,
      );
      if (!match) continue;
      const identity = match[1]?.trim();
      const basis = match[2]?.trim();
      const appearances = parseAppearances(match[3] ?? '').filter(
        (range) => Number.isFinite(range.startSecs) && Number.isFinite(range.endSecs),
      );
      if (!identity || !basis || appearances.length === 0) continue;
      const key = `${basis}\u0000${identity}`;
      const subject = subjects.get(key) ?? { identity, basis, appearances: [] };
      subject.appearances.push(...appearances);
      subjects.set(key, subject);
    }
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* plain text is not a structured answer-level media result */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success === true && mediaClaimIsAnswerLevel(record.claimVerification)) {
      addEvidence(record.evidence);
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
  };
  const rendered = [...subjects.values()]
    .map((subject) => ({
      ...subject,
      appearances: subject.appearances
        .sort((left, right) => left.startSecs - right.startSecs || left.endSecs - right.endSecs)
        .filter(
          (range, index, ranges) =>
            index === 0 ||
            range.startSecs !== ranges[index - 1]?.startSecs ||
            range.endSecs !== ranges[index - 1]?.endSecs,
        ),
    }))
    .filter((subject) => subject.appearances.length > 1)
    .map(
      (subject) =>
        `I saw ${subject.identity} at ${subject.appearances
          .map((range) =>
            range.endSecs > range.startSecs
              ? `${formatTime(range.startSecs)}–${formatTime(range.endSecs)}`
              : formatTime(range.startSecs),
          )
          .join(' and ')}.`,
    );
  // Several subjects in the selected evidence are source context, not proof
  // that a visibility inventory is the requested answer.  A single recurring
  // subject is unambiguous and can safely bypass prose re-interpretation.
  return rendered.length === 1
    ? `${rendered[0]} These are separate observed moments, not continuous visibility.`
    : undefined;
}

/** Render a final two-sided numeric outcome without waiting on a slow prose model. */
export function formatOutcomeMediaAnswer(
  value: unknown,
  investigation: VideoInvestigationDirective,
): string | undefined {
  if (investigation.goal !== 'trace') return undefined;
  type Reading = { at: number; text: string };
  const readings: Reading[] = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified evidence qualifies */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success === true && mediaClaimIsAnswerLevel(record.claimVerification)) {
      const temporal = record.temporalContext as { readings?: unknown } | undefined;
      if (Array.isArray(temporal?.readings)) {
        for (const item of temporal.readings) {
          if (!item || typeof item !== 'object') continue;
          const reading = item as { atSecs?: unknown; text?: unknown };
          if (typeof reading.text !== 'string') continue;
          readings.push({ at: Number(reading.atSecs ?? 0), text: reading.text });
        }
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);

  const cleanLabel = (label: string) =>
    label
      .replace(/^.*?(?:(?:final\s+)?(?:result|score)|النتيجة(?:\s+النهائية)?)\s*:\s*/iu, '')
      .replace(/^(?:Reconciled|Indexed)\s+state:\s*/i, '')
      .replace(/^(?:(?:final\s+)?(?:result|score)|النتيجة(?:\s+النهائية)?)\s*/iu, '')
      .replace(/^[\s:،؛,.'"“”‘’_-]+|[\s:،؛,.'"“”‘’_-]+$/gu, '')
      .trim();
  // Scoreboards commonly render `left side 2 - 1 right side`. Preserve that
  // left/right binding; reducing the score to two unlabeled numbers can swap
  // the winner when a nearby summary lists the teams in another order.
  const scorelinePattern =
    /^\s*(.+?\p{L})\s+(\d+(?:[.,]\d+)?)\s*[-–—−]\s*(\d+(?:[.,]\d+)?)\s+(\p{L}.*?)\s*$/u;
  const scorelineCandidates = readings
    .sort((left, right) => left.at - right.at)
    .flatMap((reading) => {
      const quoted = [...reading.text.matchAll(/["'“”‘’]([^"'“”‘’\n]{2,180})["'“”‘’]/gu)].map(
        (match) => match[1],
      );
      const segments = quoted.length > 0 ? quoted : reading.text.split('\n');
      return segments.flatMap((segment) => {
        const match = segment.match(scorelinePattern);
        if (!match) return [];
        const left = { label: cleanLabel(match[1]), value: Number(match[2].replace(',', '.')) };
        const right = { label: cleanLabel(match[4]), value: Number(match[3].replace(',', '.')) };
        return left.label &&
          right.label &&
          Number.isFinite(left.value) &&
          Number.isFinite(right.value)
          ? [{ ...reading, pairs: [left, right] }]
          : [];
      });
    });
  const pairPattern =
    /([^=,;،؛\n]{2,100}?)(?:\s*=\s*|\s*:\s*|\s+)(-?\d+(?:[.,]\d+)?)(?=$|[,;،؛])/gu;
  const candidates = readings
    .sort((left, right) => left.at - right.at)
    .map((reading) => {
      const pairs = [...reading.text.matchAll(pairPattern)].map((match) => ({
        label: cleanLabel(match[1] ?? ''),
        value: Number((match[2] ?? '').replace(',', '.')),
      }));
      return {
        ...reading,
        pairs: pairs.filter((pair) => pair.label && Number.isFinite(pair.value)),
      };
    })
    .filter((reading) => reading.pairs.length === 2);
  const settled = scorelineCandidates.at(-1) ?? candidates.at(-1);
  if (!settled) return undefined;
  const [left, right] = settled.pairs;
  if (left.value === right.value) {
    return `It ended level at ${left.value}–${right.value}.`;
  }
  const winner = left.value > right.value ? left : right;
  const runnerUp = winner === left ? right : left;
  return `${winner.label} won, ${winner.value}–${runnerUp.value} over ${runnerUp.label}.`;
}

/** Use the strongest bounded source reading directly when it already settled the question. */
export function formatDirectObservationAnswer(value: unknown, question = ''): string | undefined {
  const readings: Array<{ found: string; confidence: string; at: string }> = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified evidence qualifies */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.success === true && mediaClaimIsAnswerLevel(record.claimVerification)) {
      const direct = record.directObservation as { readings?: unknown } | undefined;
      if (Array.isArray(direct?.readings)) {
        for (const item of direct.readings) {
          if (!item || typeof item !== 'object') continue;
          const reading = item as {
            found?: unknown;
            confidence?: unknown;
            at?: unknown;
            settlesQuestion?: unknown;
            coverageComplete?: unknown;
          };
          if (typeof reading.found !== 'string' || !reading.found.trim()) continue;
          // This is a visible fallback, so it must only use a re-watch that
          // explicitly answered the exact question. A related observation is
          // still useful tool context for the answer model, but never a final
          // answer by itself.
          if (reading.settlesQuestion !== true) continue;
          if (reading.coverageComplete === false) continue;
          if (/^Observed context \(not a complete answer\):/i.test(reading.found.trim())) {
            continue;
          }
          readings.push({
            found: reading.found.trim(),
            confidence: String(reading.confidence ?? ''),
            at: String(reading.at ?? ''),
          });
        }
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  const asksForGroupAppearance =
    /\b(?:each|every|all|both)\b[\s\S]{0,50}\b(?:wear|wearing|wore|dressed|clothes|clothing|outfit|appearance)\b|\b(?:wear|wearing|wore|dressed|clothes|clothing|outfit|appearance)\b[\s\S]{0,50}\b(?:each|every|all|both)\b/i.test(
      question,
    );
  const best = readings.sort(
    (left, right) =>
      (asksForGroupAppearance
        ? Number(/@[\w.-]+/.test(left.found)) - Number(/@[\w.-]+/.test(right.found))
        : 0) ||
      Number(right.confidence === 'high') - Number(left.confidence === 'high') ||
      Math.min(right.found.length, 600) - Math.min(left.found.length, 600),
  )[0];
  if (!best) return undefined;
  if (!asksForGroupAppearance) return best.found;
  return best.found
    .replace(/\s*\([^)]*@[\w.-]+[^)]*\)/g, '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/@[\w.-]+/.test(sentence))
    .join(' ')
    .trim();
}

/** Render a compact, source-grounded participant roster without relying on prose-model formatting. */
export function formatParticipantInventory(value: unknown, question: string): string | undefined {
  const participants: Array<{ name: string; description: string; at: number }> = [];
  const seen = new Set<string>();
  const textOf = (payload: unknown) => {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified media results qualify */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (
      record.success === true &&
      mediaClaimIsAnswerLevel(record.claimVerification) &&
      Array.isArray(record.evidence)
    ) {
      for (const item of record.evidence as Array<Record<string, unknown>>) {
        const sourceText = textOf(item.payload) || (typeof item.text === 'string' ? item.text : '');
        const match = sourceText.match(
          /^Reconciled participant:\s*([^—\n]{1,120})\s*—\s*([^\n]+)/imu,
        );
        if (!match) continue;
        const name = match[1]!.trim();
        const description = match[2]!.trim();
        const range = (item.timeRange ?? {}) as { startSecs?: unknown };
        const at = Number(range.startSecs ?? item.startSecs ?? 0);
        const key = name.normalize('NFKC').toLocaleLowerCase();
        if (!name || !description || seen.has(key)) continue;
        seen.add(key);
        participants.push({ name, description, at: Number.isFinite(at) ? at : 0 });
      }
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  if (participants.length === 0) return undefined;

  const ordered = participants.sort((left, right) => left.at - right.at);
  const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|');
  return `| Participant | Description | Timestamp |\n| --- | --- | --- |\n${ordered
    .map(
      (participant) =>
        `| ${escapeCell(participant.name)} | ${escapeCell(participant.description)} | [${displayTimecode(participant.at)}] |`,
    )
    .join('\n')}`;
}

function displayTimecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Render a verified complete media inventory without putting hundreds of
 * already-final source items through another model context window.
 */
export function formatExhaustiveMediaAnswer(value: unknown, _question: string): string | undefined {
  type Item = {
    at: number;
    text: string;
    sourceInventory: boolean;
    answer?: string;
    respondent?: string;
  };
  let complete: Item[] | undefined;
  let inventorySummary: string | undefined;
  const textOf = (payload: unknown) => {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  };
  const clean = (raw: string) => {
    const sourceLine = raw
      .split(
        /\n(?=(?:Context|Answer|Answered by|Source answer|Source respondent|Source task id|Claim question|Claim verdict|Claim answer):)/i,
        1,
      )[0]
      .replace(/^(?:Reconciled|Indexed)\s+(?:state|event|context|overview):\s*/i, '')
      .replace(/^(?:Source (?:question|item|structure)(?:\s*\([^)]*\))?|Question):\s*/i, '')
      .trim();
    return sourceLine;
  };
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      try {
        visit(JSON.parse(candidate));
      } catch {
        /* only structured verified evidence qualifies */
      }
      return;
    }
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    const continuation = record.continuation as
      { exhaustive?: unknown; hasMore?: unknown; contextLimitReached?: unknown } | undefined;
    const inventory = record.inventory as
      { recordSet?: unknown; coverage?: { complete?: unknown; reason?: unknown } } | undefined;
    const directive = (record.investigation as { directive?: unknown } | undefined)?.directive as
      { scope?: unknown; goal?: unknown } | undefined;
    // An exhaustive evidence page is a retrieval property, not an instruction
    // to recite it. Modern video evidence carries the agent's investigation
    // directive: only an explicit source inventory may bypass answer synthesis.
    const isExplicitSourceInventory =
      directive?.scope === 'source' && directive.goal === 'enumerate';
    // A structured inventory is already a final data result. It must never be
    // handed back to a prose model just because the source correctly reports
    // partial coverage. The UI has the complete returned table; this message
    // only explains its scope and truth status.
    if (
      record.success === true &&
      continuation?.exhaustive === true &&
      continuation.hasMore !== true &&
      continuation.contextLimitReached !== true &&
      inventory &&
      typeof inventory === 'object' &&
      typeof inventory.recordSet === 'string' &&
      Array.isArray(record.rows)
    ) {
      const count = record.rows.length;
      const completeCoverage = inventory.coverage?.complete === true;
      const reason =
        typeof inventory.coverage?.reason === 'string' ? inventory.coverage.reason.trim() : '';
      inventorySummary = completeCoverage
        ? `I completed the source-wide ${inventory.recordSet} inventory: ${count} records. The full searchable and downloadable table is above.`
        : `I completed a scan of ${count} indexed ${inventory.recordSet} records. The table above contains every matching record currently available, but it is not a guarantee of complete source coverage${reason ? `: ${reason}` : '.'}`;
      return;
    }
    if (
      record.success === true &&
      continuation?.exhaustive === true &&
      continuation.hasMore !== true &&
      mediaClaimIsAnswerLevel(record.claimVerification) &&
      (!directive || isExplicitSourceInventory) &&
      Array.isArray(record.evidence)
    ) {
      complete = (record.evidence as Array<Record<string, unknown>>)
        .map((item) => {
          const range = (item.timeRange ?? {}) as { startSecs?: unknown };
          const at = Number(range.startSecs ?? item.startSecs ?? 0);
          const raw = textOf(item.payload);
          const answer = raw.match(/^(?:Source answer|Answer):\s*(.+)$/imu)?.[1]?.trim();
          const respondent = raw
            .match(/^(?:Source respondent|Answered by):\s*(.+)$/imu)?.[1]
            ?.trim();
          return {
            at: Number.isFinite(at) ? at : 0,
            text: clean(raw),
            ...(answer ? { answer } : {}),
            ...(respondent ? { respondent } : {}),
            sourceInventory:
              /^(?:Source (?:question|item|structure)(?:\s*\([^)]*\))?|Question):/i.test(
                raw.trim(),
              ),
          };
        })
        .filter((item) => item.text)
        .sort((left, right) => left.at - right.at);
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  if (inventorySummary) return inventorySummary;
  if (!complete || complete.length === 0) return undefined;
  const seen = new Set<string>();
  const items = complete.filter((item) => {
    const key = `${Math.floor(item.at)}:${item.text.normalize('NFKC').toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Small ordinary inventories (a roster or a handful of states) benefit from
  // natural synthesis. Source-authored inventory records are already the exact
  // requested units, and a large result must avoid another context window.
  if (items.length <= 48 && !items.every((item) => item.sourceInventory)) return undefined;
  // Legacy tool records have no structured `rows` field. When they carry
  // answer columns, render their data shape directly; this is independent of
  // the user's vocabulary or language. Newer records take the data-table path
  // above and never reach this compatibility branch.
  if (items.every((item) => item.sourceInventory) && items.some((item) => item.respondent)) {
    const escapeCell = (cell: string | undefined) => (cell || '—').replace(/\|/g, '\\|');
    const header = '| Question | Answered by | Answer |';
    const divider = '| --- | --- | --- |';
    return `${header}\n${divider}\n${items
      .map(
        (item) =>
          `| [${displayTimecode(item.at)}] ${escapeCell(item.text)} | ${escapeCell(
            item.respondent,
          )} | ${escapeCell(item.answer)} |`,
      )
      .join('\n')}`;
  }
  return `Here is the complete list in chronological order:\n\n${items
    .map((item) => `- [${displayTimecode(item.at)}] ${item.text}`)
    .join('\n')}`;
}

/** Guarantee a visible, normally-closing UI answer without delaying AI SDK lifecycle events. */
export function recoverEmptyUIMessageStream(fallbackText: string) {
  const fallback =
    fallbackText.trim() ||
    'I found the relevant source, but the answer could not be completed. Please try again.';

  return () => {
    let hasText = false;
    let recoveryEmitted = false;

    const emitRecovery = (
      controller: TransformStreamDefaultController<any>,
      recoveryText = fallback,
    ) => {
      if (hasText || recoveryEmitted) return;
      const id = `answer-${crypto.randomUUID()}`;
      controller.enqueue({ type: 'text-start', id });
      controller.enqueue({ type: 'text-delta', id, delta: recoveryText });
      controller.enqueue({ type: 'text-end', id });
      hasText = true;
      recoveryEmitted = true;
    };

    return new TransformStream<any, any>({
      transform(chunk, controller) {
        if (!chunk || typeof chunk !== 'object') return;
        if (chunk.type === 'text-delta' && String(chunk.delta ?? '').trim()) hasText = true;
        if (chunk.type === 'error') {
          emitRecovery(controller, String(chunk.errorText ?? '').trim() || fallback);
          // A recovered error is ordinary assistant text. Do not also leave the
          // client in its error state with a duplicate red technical banner.
          return;
        }
        if (chunk.type === 'finish') emitRecovery(controller);
        controller.enqueue(chunk);
      },
      flush(controller) {
        emitRecovery(controller);
      },
    });
  };
}

function compactMediaEvidence(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = value as Record<string, any>;
  if (typeof result.mediaAssetId !== 'string' || !Array.isArray(result.evidence)) return value;
  const exhaustive = result.continuation?.exhaustive === true;
  const evidenceLimit = exhaustive ? 240 : 48;
  const payloadLimit = exhaustive ? 260 : 700;
  return {
    success: result.success,
    mediaAssetId: result.mediaAssetId,
    fileName: result.fileName,
    supportingClip: result.supportingClip,
    claimVerification: result.claimVerification,
    investigation: result.investigation,
    observedSubjects: Array.isArray(result.observedSubjects)
      ? result.observedSubjects.slice(0, 200)
      : undefined,
    continuation: result.continuation,
    directObservation: result.directObservation
      ? {
          rule: result.directObservation.rule,
          readings: Array.isArray(result.directObservation.readings)
            ? result.directObservation.readings.slice(0, 12).map((reading: any) => ({
                range: reading.range,
                at: reading.at,
                found: reading.found,
                read: Array.isArray(reading.read) ? reading.read.slice(0, 12) : reading.read,
                confidence: reading.confidence,
              }))
            : [],
        }
      : undefined,
    temporalContext: result.temporalContext
      ? {
          rule: result.temporalContext.rule,
          readings: Array.isArray(result.temporalContext.readings)
            ? result.temporalContext.readings.slice(-48)
            : [],
        }
      : undefined,
    evidence: result.evidence.slice(0, evidenceLimit).map((item: any) => ({
      id: item.id ?? item.evidenceId,
      modality: item.modality,
      timeRange: item.timeRange ?? {
        startSecs: item.startSecs,
        endSecs: item.endSecs,
        precision: item.precision,
      },
      payload:
        typeof item.payload === 'string'
          ? item.payload.slice(0, payloadLimit)
          : (item.payload ??
            (typeof item.text === 'string' ? item.text.slice(0, payloadLimit) : item.text)),
      confidence: item.confidence,
      conflicted: item.conflicted,
    })),
  };
}

/** Keep page-local text and visual readings when they travel with a search result. */
function compactPdfPageEvidence(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = value as Record<string, any>;
  if (!Array.isArray(result.pages)) return undefined;
  return {
    success: result.success,
    documentId: result.documentId,
    title: result.title,
    totalPages: result.totalPages,
    pages: result.pages.slice(0, 3).map((page: any) => ({
      pageNumber: page.pageNumber,
      text: typeof page.text === 'string' ? page.text.slice(0, 1_600) : undefined,
      tables: Array.isArray(page.tables) ? page.tables.slice(0, 2) : undefined,
      analysis: typeof page.analysis === 'string' ? page.analysis.slice(0, 3_000) : undefined,
      previewUrl: page.previewUrl,
    })),
  };
}

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
              description:
                typeof image.description === 'string'
                  ? image.description.slice(0, 1_600)
                  : undefined,
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
      ...(result.videoEvidence !== undefined
        ? { videoEvidence: compactMediaEvidence(result.videoEvidence) }
        : {}),
      ...(compactPdfPageEvidence(result.pdfInspection)
        ? { pdfInspection: compactPdfPageEvidence(result.pdfInspection) }
        : {}),
      ...(compactPdfPageEvidence(result.pdfVisualAnalysis)
        ? { pdfVisualAnalysis: compactPdfPageEvidence(result.pdfVisualAnalysis) }
        : {}),
    };
  } else if (typeof result.mediaAssetId === 'string' && Array.isArray(result.evidence)) {
    compact = compactMediaEvidence(result) as Record<string, any>;
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
  } else if (
    (toolName === 'inspectPdfPages' || toolName === 'analyzePdfPages') &&
    Array.isArray(result.pages)
  ) {
    compact = compactPdfPageEvidence(result);
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
import type { VideoInvestigationDirective } from '@larkup/core/video-knowledge/query-planner';
