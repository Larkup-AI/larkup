import { describe, expect, it } from 'vitest';
import { isUsableFinding, parseFinding, type QuickLookFinding } from './quick-look';

function finding(overrides: Partial<QuickLookFinding> = {}): QuickLookFinding {
  return {
    range: { startSecs: 10, endSecs: 40 },
    at: '0:10–0:40',
    found: 'The displayed total changes from 0 to 1.',
    settlesQuestion: true,
    read: ['0 - 1'],
    confidence: 'high',
    frameCount: 24,
    elapsedMs: 4_200,
    ...overrides,
  };
}

describe('isUsableFinding', () => {
  it('accepts a reading that established something', () => {
    expect(isUsableFinding(finding())).toBe(true);
  });

  it('never treats a failed re-watch as the source being silent', () => {
    // The difference matters: "the reader could not run" must not reach the
    // user as "the video does not show this".
    expect(isUsableFinding(finding({ error: 'ffmpeg failed (1)', found: '' }))).toBe(false);
    expect(isUsableFinding(finding({ found: '   ' }))).toBe(false);
    expect(isUsableFinding(finding({ found: '', frameCount: 0 }))).toBe(false);
  });

  it('keeps a low-confidence reading only when it still settles the question', () => {
    expect(
      isUsableFinding(finding({ confidence: 'low', found: 'A value is partly obscured.' })),
    ).toBe(true);
    expect(
      isUsableFinding(
        finding({
          settlesQuestion: false,
          confidence: 'low',
          found: 'Two people are visible, but their names are missing.',
        }),
      ),
    ).toBe(false);
  });
});

describe('parseFinding', () => {
  it('reads a plain JSON reading as-is', () => {
    const parsed = parseFinding(
      '{"settlesQuestion":true,"found":"The total reached 240.","confidence":"high","read":["240"]}',
    );
    expect(parsed.found).toBe('The total reached 240.');
    expect(parsed.read).toEqual(['240']);
    expect(parsed.confidence).toBe('high');
    expect(parsed.settlesQuestion).toBe(true);
  });

  it('survives a markdown fence', () => {
    const parsed = parseFinding(
      '```json\n{"found":"A label reads R. Diaz.","confidence":"medium"}\n```',
    );
    expect(parsed.found).toBe('A label reads R. Diaz.');
    expect(parsed.confidence).toBe('medium');
  });

  it('recovers a reading prefixed with prose', () => {
    // Re-running a whole look costs another round trip, so an otherwise valid
    // object behind a short acknowledgement is worth decoding rather than losing.
    const parsed = parseFinding(
      'Here is what I saw:\n{"found":"The counter advances.","confidence":"low"}\nHope that helps.',
    );
    expect(parsed.found).toBe('The counter advances.');
  });

  it('keeps the prose when the reading is not JSON at all', () => {
    // The reader still looked at the frames. Throwing its words away would
    // report the source as silent because of a formatting slip.
    const parsed = parseFinding('The banner reads OPEN and nobody is at the desk.');
    expect(String(parsed.found)).toMatch(/banner reads OPEN/);
  });
});
