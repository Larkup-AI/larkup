import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRecoveryCsv, readRecovery } from '../lib/server/recovery.js';
test('recovery CSV preserves multiline answers, escaped quotes and unmodified scores', () => {
  const rows = parseRecoveryCsv(
    'reader,question_id,new_answer,cumulative_correct\nalpha,independent,"A ""quoted"" state\nthen another",False\n',
  );
  assert.equal(rows[0].reader, 'alpha');
  assert.equal(rows[0].cumulative_correct, 'False');
  assert.equal(rows[0].new_answer, 'A \"quoted\" state\nthen another');
});
test('recovery rejects truncated CSV instead of showing partial scores', () => {
  assert.throws(() => parseRecoveryCsv('reader,answer\nalpha,"incomplete'), /Incomplete/);
});

test('only matching runs expose verified recovery totals; inconsistent scores fail closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'recovery-report-'));
  const folder = path.join(root, 'data', 'attempt');
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'baseline.json'),
      JSON.stringify({
        latestRunId: 'run-fixture',
        pilotRunId: 'run-pilot',
        questions: {
          q1: { question: 'First?', options: ['x', 'y'] },
          q2: { question: 'Second?', options: ['u', 'v'] },
        },
      }),
    );
    await writeFile(
      path.join(root, 'results.csv'),
      'reader,question_id,cumulative_correct,new_option,official_option,new_answer\nalpha,q1,True,A,A,\nalpha,q2,False,,B,\n',
    );
    const summary = {
      method: 'cumulative',
      rows: [{ reader: 'alpha', total: 2, cumulativeCorrect: 1, baselineCorrect: 0 }],
    };
    await writeFile(path.join(folder, 'summary.json'), JSON.stringify(summary));
    const report = await readRecovery('run-fixture', root);
    assert.equal(report?.models[0].correct, 1);
    assert.equal(report?.models[0].failed.length, 1);
    assert.equal(await readRecovery('run-unrelated', root), null);
    summary.rows[0].cumulativeCorrect = 2;
    await writeFile(path.join(folder, 'summary.json'), JSON.stringify(summary));
    await assert.rejects(() => readRecovery('run-fixture', root), /does not match/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
