import assert from 'node:assert/strict';
import test from 'node:test';
import { planVideoQuestion, type VideoInvestigationDirective } from './query-planner';

const directive = (
  scope: VideoInvestigationDirective['scope'],
  goal: VideoInvestigationDirective['goal'],
  evidence?: VideoInvestigationDirective['evidence'],
): VideoInvestigationDirective => ({ scope, goal, ...(evidence ? { evidence } : {}) });

test('planVideoQuestion: translates a source-wide enumeration into a scan', () => {
  const plan = planVideoQuestion('أي سؤال', {
    ...directive('source', 'enumerate', ['visual', 'speech']),
    recordSet: 'source-authored',
  });

  assert.equal(plan.route, 'scan');
  assert.deepEqual(plan.modalities, ['visual', 'transcript']);
  assert.equal(plan.requiresBroadCoverage, true);
  assert.equal(plan.requiresBothRanges, true);
  assert.ok(plan.kinds.includes('coverage'));
  assert.ok(plan.kinds.includes('source-inventory'));
});

test('planVideoQuestion: maps the declared operation without reading question wording', () => {
  const questions = [
    'What happens next?',
    'ما الذي يحدث بعد ذلك؟',
    'この後何が起こりますか？',
    '¿Qué sucede después?',
  ];
  const expected = planVideoQuestion(
    questions[0],
    directive('temporal', 'trace', ['visual', 'computed']),
  );

  for (const question of questions.slice(1)) {
    assert.deepEqual(
      planVideoQuestion(question, directive('temporal', 'trace', ['visual', 'computed'])),
      expected,
    );
  }
  assert.equal(expected.route, 'temporal');
  assert.ok(expected.kinds.includes('state-change'));
});

test('planVideoQuestion: preserves a focused factual lookup as a search', () => {
  const plan = planVideoQuestion('anything', directive('focused', 'answer', ['visible-text']));
  assert.equal(plan.route, 'search');
  assert.deepEqual(plan.modalities, ['ocr']);
  assert.equal(plan.requiresBothRanges, false);
  assert.ok(plan.kinds.includes('visual-fact'));
});

test('planVideoQuestion: carries a model-resolved time range without parsing the question language', () => {
  const plan = planVideoQuestion('فى الدقيقة الرابعة عشر، مين ظهر؟', {
    ...directive('focused', 'answer', ['visual']),
    timeRange: { startSecs: 840, endSecs: 900 },
  });

  assert.deepEqual(plan.investigation.timeRange, { startSecs: 840, endSecs: 900 });
});

test('planVideoQuestion: uses aggregate retrieval for a full-source synthesis', () => {
  const plan = planVideoQuestion('anything', directive('source', 'synthesize'));
  assert.equal(plan.route, 'aggregate');
  assert.equal(plan.requiresBroadCoverage, true);
  assert.deepEqual(plan.modalities, ['transcript', 'ocr', 'visual', 'computed']);
});

test('planVideoQuestion: routes an observed-subject inventory to the typed aggregate', () => {
  const plan = planVideoQuestion('任意の表現', {
    ...directive('source', 'enumerate', ['visual']),
    recordSet: 'observed',
  });

  assert.equal(plan.route, 'aggregate');
  assert.equal(plan.requiresBroadCoverage, true);
  assert.equal(plan.requiresIdentityContext, true);
  assert.ok(plan.kinds.includes('entity-inventory'));
  assert.ok(plan.kinds.includes('coverage'));
  assert.ok(!plan.kinds.includes('source-inventory'));
});

test('planVideoQuestion: refuses a malformed directive instead of guessing from language', () => {
  assert.throws(
    () =>
      planVideoQuestion('how many?', {
        scope: 'focused',
        goal: 'unknown' as VideoInvestigationDirective['goal'],
      }),
    /content-neutral directive/,
  );
});
