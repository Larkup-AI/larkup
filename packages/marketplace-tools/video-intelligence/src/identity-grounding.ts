type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
const key = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
const label = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function mentions(text: string, name: string) {
  const escaped = name.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(
    text.normalize('NFKC'),
  );
}

/** Project source records into answer evidence without changing the stored index. */
export function groundVideoIdentityEvidence<T>(value: T): T {
  const input = record(value);
  if (!input || !Array.isArray(input.evidence)) return value;
  const subjects = Array.isArray(input.observedSubjects) ? input.observedSubjects : [];
  const unresolved = subjects.flatMap((item) => {
    const subject = record(item);
    return subject?.identityBasis === 'unresolved' && label(subject.identity)
      ? [label(subject.identity)]
      : [];
  });
  let withheld = 0;
  const authored = ['source-authored', 'source-questions', 'speech'].includes(
    label(record(input.inventory)?.recordSet),
  );

  const sanitize = (text: string, timeRange?: RecordValue, context = text) => {
    if (!text.trim()) return text;
    const local = context.split(/\r?\n/).flatMap((line) => {
      if (!line.startsWith('Visible subject:')) return [];
      try {
        const item = record(JSON.parse(line.slice('Visible subject:'.length)));
        return item ? [item] : [];
      } catch {
        return [];
      }
    });
    const allowed = new Set(
      local
        .filter(
          (item) =>
            item.identityBasis === 'source-named' || item.identityBasis === 'source-described',
        )
        .map((item) => key(label(item.identity))),
    );
    // An identity established elsewhere is useful only at its observed range.
    for (const item of subjects) {
      const subject = record(item);
      if (
        !subject ||
        subject.identityBasis !== 'source-named' ||
        !timeRange ||
        !Array.isArray(subject.appearances)
      )
        continue;
      if (
        subject.appearances.some((entry) => {
          const range = record(entry);
          return (
            range &&
            typeof range.startSecs === 'number' &&
            typeof range.endSecs === 'number' &&
            typeof timeRange.startSecs === 'number' &&
            typeof timeRange.endSecs === 'number' &&
            range.startSecs <= timeRange.endSecs &&
            range.endSecs >= timeRange.startSecs
          );
        })
      )
        allowed.add(key(label(subject.identity)));
    }
    for (const item of local)
      if (item.identityBasis === 'unresolved') allowed.delete(key(label(item.identity)));
    const candidates = [
      ...unresolved,
      ...local
        .filter((item) => item.identityBasis === 'unresolved')
        .map((item) => label(item.identity)),
      ...Array.from(context.matchAll(/^Present:\s*(.+?)\s+—/gm), (match) => match[1]!.trim()),
    ];
    const blocked = [...new Set(candidates.filter((name) => name && !allowed.has(key(name))))];
    const hasInference = /^Happened \(inferred\):/mu.test(context);
    const lines = text.split(/\r?\n/).filter((line) => {
      const inferred = /^Happened \(inferred\):/u.test(line);
      const unsafe = !line.startsWith('On screen:') && blocked.some((name) => mentions(line, name));
      // Free-form summaries can repeat an inferred event without its qualifier.
      const unqualifiedSummary = hasInference && line.trim() && !/^[\w -]+:/.test(line);
      if (inferred || unsafe || unqualifiedSummary) {
        withheld++;
        return false;
      }
      return true;
    });
    return (
      lines.join('\n').trim() ||
      'Visual attribution withheld: the source does not establish the actor identity or action.'
    );
  };

  const byId = new Map<string, { text: string; context: string; range?: RecordValue }>();
  const evidence = input.evidence.map((entry) => {
    const item = record(entry);
    const payload = record(item?.payload);
    if (
      !item ||
      !payload ||
      typeof payload.text !== 'string' ||
      authored ||
      item.modality === 'transcript' ||
      /^(?:Source (?:question|item|structure))/u.test(payload.text)
    )
      return entry;
    const text = sanitize(payload.text, record(item.timeRange));
    if (typeof item.id === 'string')
      byId.set(item.id, { text, context: payload.text, range: record(item.timeRange) });
    return { ...item, payload: { ...payload, text } };
  });
  const rows = Array.isArray(input.rows)
    ? input.rows.map((entry) => {
        const row = record(entry);
        if (!row || typeof row.id !== 'string' || !byId.has(row.id)) return entry;
        const item = byId.get(row.id)!;
        return {
          ...row,
          Content: item.text,
          Answer: sanitize(label(row.Answer), item.range, item.context),
          Respondent: sanitize(label(row.Respondent), item.range, item.context),
        };
      })
    : undefined;
  const extra = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(extra);
    const item = record(entry);
    if (!item) return entry;
    return Object.fromEntries(
      Object.entries(item).map(([name, child]) => [
        name,
        ['text', 'found', 'summary', 'overview'].includes(name) && typeof child === 'string'
          ? sanitize(child, record(item.range) ?? record(item.timeRange))
          : extra(child),
      ]),
    );
  };
  const directObservation = input.directObservation ? extra(input.directObservation) : undefined;
  const temporalContext = input.temporalContext ? extra(input.temporalContext) : undefined;
  const output = {
    ...input,
    evidence,
    ...(rows ? { rows } : {}),
    ...(Array.isArray(input.observedSubjects)
      ? {
          observedSubjects: subjects.filter((item) => record(item)?.identityBasis !== 'unresolved'),
        }
      : {}),
    ...(directObservation ? { directObservation } : {}),
    ...(temporalContext ? { temporalContext } : {}),
  };
  if (withheld > 0)
    Object.assign(output, {
      identityGrounding: {
        withheldUnits: withheld,
        instruction:
          'Some visual attributions were withheld. A spoken name or unresolved identity does not establish a named visible actor or their action. Report the remaining observations, keep uncertain identities/actions unconfirmed, and never reconstruct withheld claims. Sampled observations do not prove every person or every event was captured.',
      },
      claimVerification: {
        ...record(input.claimVerification),
        status: 'needs-corroboration',
        directlyEstablished: false,
        rule: 'Answer only from the remaining grounded evidence. A source-complete scan is not proof of a complete person/action inventory. Identity, appearance, and action each need their own source evidence.',
      },
    });
  return output as T;
}
