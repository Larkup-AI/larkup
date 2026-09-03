import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSemanticEvidenceUnits,
  semanticScoresByEvidenceId,
  type SemanticEvidenceHit,
} from './evidence-semantic-index';
import type { EvidenceModality, EvidenceRevision } from './types';

function evidence(
  id: string,
  modality: EvidenceModality,
  startSecs: number,
  endSecs: number,
  text: unknown,
): EvidenceRevision {
  return {
    id,
    lineageId: id,
    mediaAssetId: 'asset',
    knowledgeRevisionId: 'revision',
    modality,
    payload: { text },
    timeRange: { startSecs, endSecs, precision: 'estimated' },
    confidence: { score: 0.8, calibrationStatus: 'calibrated', uncertaintyReasons: [] },
    createdAt: '2026-09-01T00:00:00.000Z',
  } as unknown as EvidenceRevision;
}

test('buildSemanticEvidenceUnits: merges speech into seekable windows', () => {
  const units = buildSemanticEvidenceUnits([
    evidence('a', 'transcript', 0, 2, 'first line'),
    evidence('b', 'transcript', 3, 6, 'second line'),
    evidence('c', 'transcript', 500, 505, 'much later'),
  ]);
  assert.equal(units.length, 2);
  assert.ok(units[0].text.includes('first line') && units[0].text.includes('second line'));
  assert.deepEqual(units[0].evidenceIds, ['a', 'b']);
  assert.equal(units[1].text, 'much later');
});

test('buildSemanticEvidenceUnits: keeps a descriptive reading at its own timestamp', () => {
  const units = buildSemanticEvidenceUnits([
    evidence('v', 'visual', 100, 140, 'Score overlays read 3200 and 4000'),
  ]);
  assert.equal(units.length, 1);
  assert.deepEqual(units[0].evidenceIds, ['v']);
  assert.equal(units[0].startSecs, 100);
  assert.equal(units[0].endSecs, 140);
});

// A per-frame detector dump locates nothing that a caption of the same moment
// does not already say, and it would otherwise crowd out real readings.
test('buildSemanticEvidenceUnits: drops object dumps and empty readings', () => {
  const units = buildSemanticEvidenceUnits([
    evidence('o', 'visual', 10, 10, 'Detected objects: person (track 1), couch (track 2)'),
    evidence('e', 'ocr', 20, 20, '   '),
    evidence('k', 'visual', 30, 40, 'Two people shake hands in front of a scoreboard'),
  ]);
  assert.deepEqual(
    units.map((unit) => unit.evidenceIds[0]),
    ['k'],
  );
});

test('buildSemanticEvidenceUnits: flattens a structured reading into searchable text', () => {
  const [unit] = buildSemanticEvidenceUnits([
    evidence('s', 'computed', 60, 60, {
      subject: 'on-screen-text',
      property: 'recurring-overlay',
      value: '3200',
    }),
  ]);
  assert.match(unit.text, /on-screen-text/);
  assert.match(unit.text, /3200/);
});

test('buildSemanticEvidenceUnits: returns units in source order', () => {
  const units = buildSemanticEvidenceUnits([
    evidence('late', 'visual', 900, 910, 'a later moment'),
    evidence('early', 'transcript', 10, 12, 'an earlier moment'),
  ]);
  assert.deepEqual(
    units.map((unit) => unit.startSecs),
    [10, 900],
  );
});

test('buildSemanticEvidenceUnits: indexes source content instead of an echoed request protocol', () => {
  const [unit] = buildSemanticEvidenceUnits([
    evidence(
      'inspected',
      'visual',
      100,
      120,
      'A person closes the blue door.\nClaim question: what colour was the door?\nClaim verdict: partial\nUncertainty: the lighting changes',
    ),
  ]);
  assert.equal(unit.text, 'A person closes the blue door.');
});

test('buildSemanticEvidenceUnits: repeated inspection of one minute cannot crowd out the timeline', () => {
  const repeated = Array.from({ length: 20 }, (_, index) =>
    evidence(`repeat-${index}`, 'visual', 10 + index, 11 + index, `Distinct reading ${index}`),
  );
  const units = buildSemanticEvidenceUnits([
    ...repeated,
    evidence('later', 'visual', 300, 310, 'A later source moment'),
  ]);
  assert.ok(units.filter((unit) => unit.startSecs < 60).length <= 8);
  assert.ok(units.some((unit) => unit.evidenceIds.includes('later')));
});

// General-purpose embeddings put every pair in a narrow cosine band, so the
// absolute value separates almost nothing; the spread is the usable signal.
test('semanticScoresByEvidenceId: rescales a narrow cosine band to a usable range', () => {
  const hits: SemanticEvidenceHit[] = [
    {
      id: '1',
      modality: 'visual',
      startSecs: 0,
      endSecs: 1,
      text: 'a',
      evidenceIds: ['a'],
      score: 0.5,
    },
    {
      id: '2',
      modality: 'visual',
      startSecs: 2,
      endSecs: 3,
      text: 'b',
      evidenceIds: ['b'],
      score: 0.44,
    },
    {
      id: '3',
      modality: 'visual',
      startSecs: 4,
      endSecs: 5,
      text: 'c',
      evidenceIds: ['c'],
      score: 0.41,
    },
  ];
  const scores = semanticScoresByEvidenceId(hits);
  assert.equal(scores.get('a'), 1);
  assert.equal(scores.get('c'), 0.1);
  assert.ok(scores.get('b')! > 0.1 && scores.get('b')! < 1);
});

test('semanticScoresByEvidenceId: a merged unit scores every record it covers', () => {
  const scores = semanticScoresByEvidenceId([
    {
      id: '1',
      modality: 'transcript',
      startSecs: 0,
      endSecs: 40,
      text: 'a window',
      evidenceIds: ['x', 'y'],
      score: 0.5,
    },
  ]);
  assert.equal(scores.get('x'), 1);
  assert.equal(scores.get('y'), 1);
});

test('semanticScoresByEvidenceId: an empty result scores nothing', () => {
  assert.equal(semanticScoresByEvidenceId([]).size, 0);
});
