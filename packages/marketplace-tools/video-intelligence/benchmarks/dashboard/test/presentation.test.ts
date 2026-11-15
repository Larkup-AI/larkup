import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtAccuracy, fmtDuration, fmtMoney, allowedControls, STATE_TONE } from '../lib/format.js';
import { isTerminal } from '../lib/contract.js';
import { resultsToCsv } from '../lib/server/csv.js';
import type { ResultObject } from '../lib/contract.js';

test('fmtAccuracy never coerces null to zero', () => {
  assert.equal(fmtAccuracy(null, 0), 'no data');
  assert.equal(fmtAccuracy(null, 5), '—');
  assert.equal(fmtAccuracy(0.8, 10), '80.0%');
});

test('fmtMoney surfaces unknown explicitly, keeps currency', () => {
  assert.equal(fmtMoney(null), 'unknown');
  assert.equal(fmtMoney('0.42', 'USD'), 'USD 0.42');
});

test('fmtDuration marks null and scales units', () => {
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(500), '500 ms');
  assert.equal(fmtDuration(5000), '5.0 s');
  assert.equal(fmtDuration(125000), '2m 5s');
});

test('allowedControls follows the contract state machine', () => {
  assert.deepEqual(allowedControls('draft'), ['start']);
  assert.deepEqual(allowedControls('running'), ['pause', 'cancel']);
  assert.deepEqual(allowedControls('paused'), ['resume', 'cancel']);
  assert.deepEqual(allowedControls('blocked'), ['cancel']);
  assert.deepEqual(allowedControls('completed'), []);
});

test('terminal states and tones are consistent', () => {
  assert.equal(isTerminal('completed'), true);
  assert.equal(isTerminal('running'), false);
  assert.equal(STATE_TONE.running, 'go');
  assert.equal(STATE_TONE.blocked, 'warn');
});

test('CSV export is sanitized: null stays empty, commas quoted, no provider keys', () => {
  const base: ResultObject = {
    runId: 'run-1',
    sourceId: 'src-1',
    dataset: 'video-mme',
    questionId: 'q, with comma',
    variantId: 'larkup-tool',
    attemptId: 'a1',
    configRevision: 'config-03',
    durationGroup: 'short',
    sourceDurationMs: 95000,
    logicalModel: 'answer-fixed',
    resolvedModel: 'gemini-flash',
    routeId: 'r1',
    provider: 'larkup-tool',
    accountAlias: 'pod-1',
    tier: 'rental',
    state: 'completed',
    answer: 'B',
    predictedOption: 'B',
    correct: null,
    evaluationRevision: 'eval-v1',
    evidence: [],
    cost: {
      currency: 'USD',
      actual: '0.03',
      estimated: '0.03',
      unknownAttemptCount: 0,
      reconciled: true,
    },
    timing: {
      queueMs: 1,
      prepareMs: null,
      uploadMs: null,
      indexMs: 800,
      answerMs: 2,
      firstTokenMs: null,
      endToEndMs: 3,
      inputReuse: true,
      measurementProfileId: 'mp',
    },
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      reasoningTokens: null,
      cachedTokens: null,
      processingSeconds: 7,
      freeAllowanceConsumed: null,
    },
    issue: null,
  };
  const csv = resultsToCsv([base]);
  const [header, row] = csv.trim().split('\r\n');
  assert.ok(header.startsWith('runId,sourceId,dataset,questionId'));
  // correct=null -> empty field, not "false"/"0"
  const cols = parseCsvLine(row);
  const idx = header.split(',').indexOf('correct');
  assert.equal(cols[idx], '');
  assert.equal(cols[header.split(',').indexOf('indexMs')], '800');
  assert.equal(cols[header.split(',').indexOf('answerMs')], '2');
  // comma-bearing field is quoted
  assert.ok(row.includes('"q, with comma"'));
  // no secret-bearing values leaked (token COUNT columns are legitimate)
  assert.ok(!/authorization:|bearer\s|api[_-]?key|secret|password/i.test(csv));
});

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '',
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
