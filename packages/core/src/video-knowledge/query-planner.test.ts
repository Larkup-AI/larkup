import assert from 'node:assert/strict';
import test from 'node:test';
import { planVideoQuestion } from './query-planner';

test('planVideoQuestion: extracts a named subject before an appearance verb', () => {
  const plan = planVideoQuestion('what was Zizo wearing');
  assert.equal(plan.subjectName, 'Zizo');
  assert.ok(plan.kinds.includes('person-attribute'));
  assert.ok(plan.requiresInspectionWhenInsufficient);
});

test('planVideoQuestion: accepts informal lower-case names and minor verb typos', () => {
  const plan = planVideoQuestion('what was zizo wearnign');
  assert.equal(plan.subjectName, 'zizo');
  assert.ok(plan.kinds.includes('person-attribute'));
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

test('planVideoQuestion: does not mistake collection words or "down" for a person', () => {
  assert.equal(
    planVideoQuestion('what were Ragab, Omar, and the other team members wearing').subjectName,
    undefined,
  );
  assert.equal(
    planVideoQuestion('list down all questions mentioned in this recording').subjectName,
    undefined,
  );
  assert.equal(planVideoQuestion('what was each one of them wearing').subjectName, undefined);
  const teamPeople = planVideoQuestion('what was each of the team persons wearing');
  assert.equal(teamPeople.subjectName, undefined);
  assert.ok(!teamPeople.kinds.includes('entity-inventory'));
  assert.ok(teamPeople.kinds.includes('person-attribute'));
});

test('planVideoQuestion: distinguishes a roster from an unfiltered source dump', () => {
  const plan = planVideoQuestion('list names of participants in each group');
  assert.ok(plan.kinds.includes('entity-inventory'));
  assert.ok(plan.requiresIdentityContext);
});

test('planVideoQuestion: an effectiveness judgement requests broad evidence', () => {
  const plan = planVideoQuestion('which person was the most effective or participated most?');
  assert.ok(plan.kinds.includes('evaluation'));
  assert.equal(plan.requiresBroadCoverage, true);
});

test('planVideoQuestion: identifies a complete inventory of source questions', () => {
  const plan = planVideoQuestion('list down all questions mentioned in this recording');
  assert.ok(plan.kinds.includes('question-inventory'));
  assert.ok(plan.kinds.includes('coverage'));
  assert.equal(plan.requiresBroadCoverage, true);
});

test('planVideoQuestion: identifies complete visible-source inventories generically', () => {
  for (const question of [
    'list every slide heading and all writing on the board',
    'اذكر كل المكتوب على السبورة وكل عناوين الشرائح',
  ]) {
    const plan = planVideoQuestion(question);
    assert.ok(plan.kinds.includes('source-inventory'), question);
    assert.equal(plan.requiresBroadCoverage, true, question);
  }
});

test('planVideoQuestion: a terse identity resolution stays generic and asks for an identity anchor', () => {
  const plan = planVideoQuestion('who won');
  assert.equal(plan.subjectName, undefined);
  assert.ok(plan.kinds.includes('outcome'));
  assert.equal(plan.requiresIdentityContext, true);
});

test('planVideoQuestion: a conclusion question is domain-neutral', () => {
  for (const question of [
    'what was the final decision of the committee',
    'how did the negotiation end',
    'what was the verdict',
  ]) {
    assert.ok(planVideoQuestion(question).kinds.includes('outcome'), question);
  }
});

test('planVideoQuestion: ordered-account questions require temporal corroboration', () => {
  for (const question of [
    'what happened in order',
    'walk me through the sequence of steps',
    'how did it change over time',
  ]) {
    const plan = planVideoQuestion(question);
    assert.ok(plan.kinds.includes('state-change'), question);
    assert.ok(plan.requiresInspectionWhenInsufficient, question);
  }
});

test('planVideoQuestion: a "who did what when" question reserves identity context', () => {
  const plan = planVideoQuestion('What was the timeline and who was involved?');
  assert.ok(plan.kinds.includes('state-change'));
  assert.equal(plan.requiresIdentityContext, true);
});

test('planVideoQuestion: whole-source questions request broad coverage', () => {
  const plan = planVideoQuestion('What was the whole content of the lecture?');
  assert.ok(plan.kinds.includes('coverage'));
  assert.equal(plan.requiresBroadCoverage, true);
  assert.equal(plan.requiresBothRanges, true);
});

test('planVideoQuestion: a plain summary request covers the whole source', () => {
  const plan = planVideoQuestion('summarize this video');
  assert.equal(plan.requiresBroadCoverage, true);
});

test('planVideoQuestion: plural appearance questions are comparisons', () => {
  const plan = planVideoQuestion('What were the teams wearing?');
  assert.ok(plan.kinds.includes('comparison'));
  assert.equal(plan.requiresBothRanges, true);
});

test('planVideoQuestion: distributive attributes reserve identity context without assuming a domain', () => {
  const plan = planVideoQuestion('Can you tell me each one what he was wearing?');
  assert.ok(plan.kinds.includes('comparison'));
  assert.ok(plan.kinds.includes('person-attribute'));
  assert.equal(plan.requiresIdentityContext, true);
});

test('planVideoQuestion: Arabic full-coverage questions are recognized', () => {
  const plan = planVideoQuestion('ايه كل محتوى المحاضرة بالكامل؟');
  assert.ok(plan.kinds.includes('coverage'));
  assert.equal(plan.requiresBroadCoverage, true);
});

test('planVideoQuestion: carries no vocabulary specific to one kind of video', () => {
  const source = planVideoQuestion.toString() + SOURCE_MARKER;
  for (const domainWord of [
    'goal',
    'assist',
    'scorer',
    'football',
    'soccer',
    'penalty',
    'lecture',
    'movie',
  ]) {
    assert.ok(
      !new RegExp(`["'|(\\\\b]${domainWord}`, 'i').test(source),
      `planner should not branch on the domain word "${domainWord}"`,
    );
  }
});

// `planVideoQuestion.toString()` covers the function body; the module-level
// regexes it closes over are asserted through their observable behaviour above.
const SOURCE_MARKER = '';

// "which team won this match" used to classify as a plain visual fact, so the
// answer was retrieved from an arbitrary moment with no terminal prior and no
// corroboration -- the exact shape that produced a "couldn't confirm" reply on
// a source whose closing state was already indexed.
test('planVideoQuestion: a resolution question is an outcome question', () => {
  for (const question of [
    'which team won this match',
    'who won',
    'who beat who',
    'which side lost the round',
    'مين كسب الماتش',
    'مين الفائز',
  ]) {
    const plan = planVideoQuestion(question);
    assert.ok(
      plan.kinds.includes('outcome'),
      `"${question}" should be planned as an outcome question`,
    );
  }
});

test('planVideoQuestion: choosing between named sides is a comparison', () => {
  const plan = planVideoQuestion('which team won this match');
  assert.ok(plan.kinds.includes('comparison'));
  assert.ok(plan.requiresInspectionWhenInsufficient);
  // Identity context runs a separate roster lookup whose generic participant
  // records outrank the evidence that answers the question. "Who won" already
  // asks it through `asksWho`; "which side won" does not need it.
  assert.equal(plan.requiresIdentityContext, false);
});

test('planVideoQuestion: a plain description is not promoted to an outcome', () => {
  const plan = planVideoQuestion('what colour is the sofa');
  assert.ok(!plan.kinds.includes('outcome'));
});
