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

test('bounded runtime inspection receives the question as a question, not only a range reason', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-inspection-contract-'));
  const originalFetch = globalThis.fetch;
  const question = 'What symbol is engraved on the handle?';
  let submitted;
  let partial = false;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      submitted = JSON.parse(options.body);
      return Response.json({ id: 'fixture-job', status: 'queued' });
    }
    return Response.json({ id: 'fixture-job', status: 'completed', result: {
      durationMs: 10000, transcript: [], visualObservations: [], tracks: [],
      semanticObservations: [{ startMs: 2000, endMs: 4000, confidence: .95,
        text: `Claim question: ${question}\nClaim verdict: ${partial ? "partial" : "direct"}\nClaim answer: A spiral is engraved on the handle.` }],
    } });
  };
  try {
    const file = path.join(dir, 'evidence.json');
    await writeFile(file, JSON.stringify({ durationMs: 10000, transcript: [], visualObservations: [], tracks: [], semanticObservations: [] }));
    const input = { evidencePath: file, sourceId: 'workshop', retrievalQuery: 'A navigation hint about a neighboring object.', question: { question, options: ['spiral', 'square'] },
      investigation: { scope: 'focused', goal: 'resolve', evidence: ['visual'], timeRange: { startSecs: 2, endSecs: 4 } },
      protocol: {}, runtimeMode: 'managed-cloud', runtimeEndpoint: 'http://fixture.test', runtimeToken: 'fixture-only', runtimeUploadId: 'fixture-upload',
      inspectionStatePath: path.join(dir, 'inspection.json'), roles: {} };
    const result = await execute(input);
    assert.equal(submitted.source.durationSecs, 2);
    assert.equal(submitted.source.timelineDurationSecs, 10);
    assert.deepEqual(submitted.brief.expectedQuestions, [question]);
    assert.equal(submitted.brief.goal, question);
    assert.equal(result.pages[0].claimVerification.directlyEstablished, true);
    submitted = undefined;
    const readback = await execute({ ...input, reconcileOnly: true });
    assert.equal(submitted, undefined, 'saved runtime work must not be resubmitted');
    assert.equal(readback.pages[0].claimVerification.directlyEstablished, true);
    const missing = await execute({ ...input, reconcileOnly: true, inspectionStatePath: path.join(dir, 'missing.json') });
    assert.equal(submitted, undefined, 'read-back may never create a new paid job');
    assert.equal(missing.success, false);
    assert.equal(missing.toolExecutionValid, false);
    partial = true;
    const inconclusive = await execute({ ...input, reconcileOnly: true });
    assert.equal(submitted, undefined);
    assert.equal(inconclusive.readbackCompleted, true);
    assert.notEqual(inconclusive.toolExecutionValid, false);


  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
});


test('a rejected managed inspection cannot be scored as a completed evidence answer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'video-managed-failure-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'Unsupported vision provider for Video Intelligence' }, { status: 400 });
  try {
    const file = path.join(dir, 'evidence.json');
    await writeFile(file, JSON.stringify({ durationMs: 10000, transcript: [], visualObservations: [], tracks: [], semanticObservations: [] }));
    const result = await execute({ evidencePath: file, sourceId: 'workshop',
      question: { question: 'What is on the handle?', options: ['spiral', 'square'] },
      investigation: { scope: 'focused', goal: 'resolve', evidence: ['visual'], timeRange: { startSecs: 2, endSecs: 4 } },
      protocol: {}, runtimeMode: 'managed-cloud', runtimeEndpoint: 'http://fixture.test', runtimeToken: 'fixture-only',
      runtimeUploadId: 'fixture-upload', inspectionStatePath: path.join(dir, 'inspection.json'), roles: {} });
    assert.equal(result.success, false);
    assert.equal(result.toolExecutionValid, false);
    assert.ok(result.actions.some((a) => a.action === 'inspectionFailed'));
  } finally { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); }
});
