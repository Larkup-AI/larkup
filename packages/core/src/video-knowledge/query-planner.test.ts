import assert from 'node:assert/strict';
import test from 'node:test';
import { planVideoQuestion } from './query-planner';

test('planVideoQuestion: extracts a named subject before an appearance verb', () => {
  const plan = planVideoQuestion('what was Zizo wearing');
  assert.equal(plan.subjectName, 'Zizo');
  assert.ok(plan.kinds.includes('person-attribute'));
  assert.ok(plan.requiresInspectionWhenInsufficient);
});

test('planVideoQuestion: extracts a named subject after an action verb', () => {
  const plan = planVideoQuestion('who was talking to Sara at the end');
  assert.equal(plan.subjectName, 'Sara');
  assert.ok(plan.kinds.includes('person-attribute'));
});

test('planVideoQuestion: does not treat sentence-initial question words as a name', () => {
  const plan = planVideoQuestion('What was wearing a red jersey');
  assert.equal(plan.subjectName, undefined);
  assert.ok(!plan.kinds.includes('person-attribute'));
});

test('planVideoQuestion: a plain outcome question has no subjectName', () => {
  const plan = planVideoQuestion('who won the match');
  assert.equal(plan.subjectName, undefined);
  assert.ok(plan.kinds.includes('outcome'));
});
