import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evidenceInputs, execute } from '../tool-bridge.mjs';

test('canonical conversion retains transcript, visual, and anonymous tracking evidence on the original clock', () => {
  const records = evidenceInputs({ durationMs: 10000, transcript: [{ startMs: 5000, endMs: 6000, text: 'A triangle moves.' }],
    visualObservations: [], semanticObservations: [{ startMs: 7000, endMs: 8000, text: 'A blue triangle.', confidence: .9 }],
    tracks: [{ trackId: 2, label: 'person', startMs: 2000, endMs: 4000, confidence: .8, observations: 3 }] });
  assert.ok(records.some((r) => r.modality === 'transcript' && r.timeRange.startSecs === 5));
  assert.ok(records.some((r) => r.modality === 'visual' && r.timeRange.startSecs === 7));
  assert.ok(records.some((r) => r.modality === 'computed' && r.timeRange.startSecs === 2));
});

test('isolated host executes canonical querying and keeps the fixed-backbone retrieval ablation distinct', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-evidence-'));
  try {
    const file = path.join(dir, 'evidence.json');
    await writeFile(file, JSON.stringify({ durationMs: 10000, transcript: [], visualObservations: [], tracks: [],
      semanticObservations: [{ startMs: 1000, endMs: 3000, confidence: .9,
        text: 'Claim question: Which shape is visible?\nClaim verdict: direct\nClaim answer: A blue triangle is visible.' }] }));
    const input = { evidencePath: file, sourceId: 'fixture-source', question: { question: 'Which shape is visible?', options: ['circle', 'triangle'] },
      investigation: { scope: 'focused', goal: 'answer', evidence: ['visual'] }, protocol: { maxToolSteps: 4 },
      runtimeEndpoint: 'http://127.0.0.1:8787', runtimeToken: 'fixture-only', roles: {} };
    const full = await execute(input);
    assert.equal(full.success, true);
    assert.equal(full.actions[0].action, 'queryVideoEvidence');
    assert.equal(full.pages[0].claimVerification.directlyEstablished, true);
    const baseline = await execute({ ...input, simpleRetrieval: true });
    assert.equal(baseline.actions[0].action, 'simpleRetrieval');
    assert.ok(baseline.evidence.length > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
