import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTimecode, fuseFocusRanges, normalizeSignals } from './focus-ranges';

test('fuseFocusRanges: independent signals agreeing on a moment outrank one loud signal', () => {
  const ranges = fuseFocusRanges([
    // One very strong lexical hit, alone.
    { kind: 'lexical', startSecs: 100, endSecs: 110, score: 1 },
    { kind: 'lexical', startSecs: 104, endSecs: 112, score: 0.9 },
    // Two different kinds pointing at the same later moment.
    { kind: 'semantic', startSecs: 900, endSecs: 940, score: 1 },
    { kind: 'clip-embedding', startSecs: 905, endSecs: 935, score: 1 },
  ]);
  assert.equal(ranges[0].startSecs <= 940 && ranges[0].endSecs >= 900, true);
  assert.deepEqual(ranges[0].sources.slice(0, 2), ['semantic', 'clip-embedding']);
});

test('fuseFocusRanges: merges neighbouring signals into one seekable window', () => {
  const ranges = fuseFocusRanges([
    { kind: 'semantic', startSecs: 200, endSecs: 205, score: 1 },
    { kind: 'semantic', startSecs: 210, endSecs: 215, score: 0.8 },
    { kind: 'semantic', startSecs: 900, endSecs: 905, score: 0.9 },
  ]);
  assert.equal(ranges.length, 2);
  const merged = ranges.find((range) => range.startSecs < 300);
  assert.ok(merged);
  assert.ok(merged.startSecs <= 200 && merged.endSecs >= 215);
});

test('fuseFocusRanges: a narrow signal is padded to an inspectable window', () => {
  const [range] = fuseFocusRanges([{ kind: 'semantic', startSecs: 500, endSecs: 500, score: 1 }]);
  assert.ok(range.endSecs - range.startSecs >= 20);
});

test('fuseFocusRanges: never returns a window wider than the inspection cap', () => {
  const ranges = fuseFocusRanges(
    Array.from({ length: 30 }, (_, index) => ({
      kind: 'semantic' as const,
      startSecs: index * 10,
      endSecs: index * 10 + 5,
      score: index === 20 ? 1 : 0.2,
    })),
    { maxWindowSecs: 60 },
  );
  for (const range of ranges) assert.ok(range.endSecs - range.startSecs <= 60 + 1e-6);
  // The window stays centred on the strongest signal, not on the cluster's middle.
  assert.ok(ranges[0].startSecs <= 200 && ranges[0].endSecs >= 205);
});

test('fuseFocusRanges: the ending only competes, it never wins on its own', () => {
  const ranges = fuseFocusRanges([
    { kind: 'ending', startSecs: 3_000, endSecs: 3_060, score: 1 },
    { kind: 'semantic', startSecs: 1_200, endSecs: 1_240, score: 1 },
    { kind: 'clip-embedding', startSecs: 1_210, endSecs: 1_250, score: 1 },
  ]);
  assert.ok(ranges[0].startSecs < 3_000, 'a corroborated mid-source moment must outrank the tail');
});

test('fuseFocusRanges: tolerates empty and malformed input', () => {
  assert.deepEqual(fuseFocusRanges([]), []);
  assert.deepEqual(
    fuseFocusRanges([{ kind: 'semantic', startSecs: 10, endSecs: 5, score: 1 }]),
    [],
  );
});

test('normalizeSignals: rescales each kind against its own spread', () => {
  const normalized = normalizeSignals([
    { kind: 'semantic', startSecs: 0, endSecs: 1, score: 0.42 },
    { kind: 'semantic', startSecs: 2, endSecs: 3, score: 0.48 },
    { kind: 'lexical', startSecs: 0, endSecs: 1, score: 0.9 },
  ]);
  const semantic = normalized.filter((signal) => signal.kind === 'semantic');
  assert.deepEqual(semantic.map((signal) => signal.score).sort(), [0, 1]);
  // A kind with a single member carries full strength rather than zero.
  assert.equal(normalized.find((signal) => signal.kind === 'lexical')?.score, 1);
});

test('formatTimecode: renders hours only when the source needs them', () => {
  assert.equal(formatTimecode(0), '0:00');
  assert.equal(formatTimecode(152.4), '2:32');
  assert.equal(formatTimecode(3_725), '1:02:05');
});

// A whole-source summary overlaps every other signal, so leaving it in the
// clustering merged every distinct moment into one window and collapsed the
// ranked list to a single range centred on nothing in particular.
test('fuseFocusRanges: a whole-source span does not swallow every distinct moment', () => {
  const ranges = fuseFocusRanges([
    { kind: 'semantic', startSecs: 0, endSecs: 3_137, score: 1 },
    { kind: 'semantic', startSecs: 120, endSecs: 150, score: 0.9 },
    { kind: 'semantic', startSecs: 1_400, endSecs: 1_430, score: 0.8 },
    { kind: 'semantic', startSecs: 2_800, endSecs: 2_830, score: 0.7 },
  ]);
  assert.equal(ranges.length, 3);
  assert.deepEqual(
    ranges.map((range) => Math.round(range.startSecs)).sort((a, b) => a - b),
    [120, 1_400, 2_800],
  );
});
