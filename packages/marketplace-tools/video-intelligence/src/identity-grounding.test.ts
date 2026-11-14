import { describe, expect, it } from 'vitest';
import { groundVideoIdentityEvidence } from './identity-grounding.js';

const evidence = (text: string, modality = 'visual', startSecs = 1) => ({
  id: 'evidence',
  modality,
  timeRange: { startSecs, endSecs: startSecs + 3 },
  payload: { text },
});
const subject = (identity: string, identityBasis: string, startSecs = 1) => ({
  identity,
  identityBasis,
  appearances: [{ startSecs, endSecs: startSecs + 3 }],
});
const sighting = (identity: string, identityBasis: string) =>
  'Visible subject: ' + JSON.stringify({ identity, identityBasis, startMs: 1000, endMs: 4000 });

describe('visual identity grounding', () => {
  it('does not promote a legacy free-form summary when its actor is absent from the identity ledger', () => {
    const result = groundVideoIdentityEvidence({
      evidence: [
        evidence(
          'Visitor Q catches the object, according to narration.\nOn screen: entrance\nDirect component: A green sleeve is visible.',
        ),
      ],
    });
    expect(result.evidence[0]?.payload.text).not.toContain('Visitor Q');
    expect(result.evidence[0]?.payload.text).toContain('green sleeve');
    expect(result.evidence[0]?.payload.text).toContain('entrance');
  });

  it('normalizes compatibility characters and escapes punctuation in arbitrary identity labels', () => {
    for (const name of ['Ａｌｅｘ', 'Guest (R)', 'Person + helper']) {
      const result = groundVideoIdentityEvidence({
        observedSubjects: [subject(name, 'unresolved')],
        evidence: [evidence(name.normalize('NFKC') + ' moves the object.')],
      });
      expect(result.evidence[0]?.payload.text).not.toContain('moves the object');
    }
  });

  it('withholds named actions and table claims for an explicitly unresolved identity', () => {
    const original = {
      success: true,
      observedSubjects: [subject('Guest A', 'unresolved')],
      claimVerification: { status: 'directly-established', directlyEstablished: true },
      evidence: [
        evidence(
          'Guest A moves the object.\n' +
            sighting('Guest A', 'unresolved') +
            '\nPresent: Guest A — mentioned in narration\nDirect component: Guest A moves the object.\nOn screen: 12 — displayed total',
        ),
      ],
      rows: [
        { id: 'evidence', Content: 'Guest A moves the object.', Answer: 'Guest A', Respondent: '' },
      ],
    };
    const guarded = groundVideoIdentityEvidence(original);
    expect(guarded.evidence[0]?.payload.text).not.toContain('Guest A');
    expect(guarded.evidence[0]?.payload.text).toContain('On screen: 12');
    expect(guarded.rows[0]?.Content).not.toContain('Guest A');
    expect(guarded.rows[0]?.Answer).not.toContain('Guest A');
    expect(guarded.rows[0]?.Respondent).toBe('');
    expect(guarded.observedSubjects).toEqual([]);
    expect(guarded.claimVerification.directlyEstablished).toBe(false);
    expect(original.evidence[0]?.payload.text).toContain('Guest A');
  });

  it('does not promote a mentioned name into a visible actor when no identity ledger exists', () => {
    const result = groundVideoIdentityEvidence({
      evidence: [
        evidence(
          'Guest B hands over a package.\nPresent: Guest B — named in synchronized speech\nOn screen: loading bay',
        ),
      ],
    });
    expect(result.evidence[0]?.payload.text).not.toContain('Guest B');
    expect(result.evidence[0]?.payload.text).toContain('loading bay');
  });

  it('retains locally source-named actors, descriptors and their grounded actions', () => {
    const text =
      'Guest C hands over a package.\n' +
      sighting('Guest C', 'source-named') +
      '\nPresent: Guest C — readable source label\nDirect component: Guest C hands over a package.';
    const result = groundVideoIdentityEvidence({
      evidence: [evidence(text)],
      observedSubjects: [subject('Guest C', 'source-named')],
    });
    expect(result.evidence[0]?.payload.text).toContain(
      'Direct component: Guest C hands over a package.',
    );
    expect(result.evidence[0]?.payload.text).toContain(sighting('Guest C', 'source-named'));
    expect(result.observedSubjects).toHaveLength(1);
  });

  it('does not use a later remote identity anchor to identify an earlier actor', () => {
    const result = groundVideoIdentityEvidence({
      evidence: [evidence('Direct component: Guest D touches the object.')],
      observedSubjects: [subject('Guest D', 'source-named', 100)],
    });
    expect(result.evidence[0]?.payload.text).not.toContain('Guest D');
  });

  it('preserves spoken names and authored questions as source content', () => {
    const input = {
      observedSubjects: [subject('Guest E', 'unresolved')],
      evidence: [
        evidence('Guest E is discussed by the narrator.', 'transcript'),
        evidence('Source question (spoken): What did Guest E say?', 'computed'),
      ],
    };
    const result = groundVideoIdentityEvidence(input);
    expect(result.evidence).toEqual(input.evidence);
  });

  it('withholds inferred action lines and preserves directly read visual attributes', () => {
    const result = groundVideoIdentityEvidence({
      evidence: [
        evidence(
          'The participant catches the object.\nHappened (inferred): The participant catches the object.\nDirect component: The jacket is green.',
        ),
      ],
    });
    expect(result.evidence[0]?.payload.text).not.toContain('catches the object');
    expect(result.evidence[0]?.payload.text).toContain('jacket is green');
  });
  it('keeps a fresh local source binding in both evidence and table answers', () => {
    const result = groundVideoIdentityEvidence({
      observedSubjects: [subject('Guest F', 'unresolved')],
      evidence: [
        evidence(sighting('Guest F', 'source-named') + '\nDirect component: Guest F wears green.'),
      ],
      rows: [
        { id: 'evidence', Content: 'Guest F wears green.', Answer: 'Guest F', Respondent: '' },
      ],
    });
    expect(result.rows[0]?.Answer).toBe('Guest F');
    expect(result.evidence[0]?.payload.text).toContain('Guest F wears green');
  });

  it('does not let an aggregate override an explicitly unresolved local identity', () => {
    const result = groundVideoIdentityEvidence({
      observedSubjects: [subject('Guest G', 'source-named')],
      evidence: [evidence(sighting('Guest G', 'unresolved') + '\nGuest G touches the object.')],
    });
    expect(result.evidence[0]?.payload.text).not.toContain('Guest G');
  });

  it('matches dynamic multilingual identities without censoring a longer homonym', () => {
    const result = groundVideoIdentityEvidence({
      observedSubjects: [subject('علي', 'unresolved')],
      evidence: [
        evidence(
          'علي حرّك الشيء.\nDirect component: علياء ترتدي معطفًا أخضر.\n' +
            sighting('علي', 'unresolved'),
        ),
      ],
    });
    expect(result.evidence[0]?.payload.text).not.toContain('علي حرّك');
    expect(result.evidence[0]?.payload.text).toContain('علياء ترتدي');
  });

  it('retains source-described actors without promoting them to a real-world name', () => {
    const text =
      sighting('person in green', 'source-described') +
      '\nPresent: person in green — visible descriptor\nDirect component: person in green holds the object.';
    expect(
      groundVideoIdentityEvidence({ evidence: [evidence(text)] }).evidence[0]?.payload.text,
    ).toBe(text);
  });
});
