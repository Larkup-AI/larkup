import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evidenceCoverageRequirement,
  namedComparisonLabelRequirement,
  numberedCategoryGroupingRequirement,
} from '../src/lib/chat/response-style.ts';

test('requires a complete grouped summary for numbered category membership questions', () => {
  const requirement = numberedCategoryGroupingRequirement(
    'How many visits are listed, which are in person, and which are by telephone?',
  );

  assert.match(requirement, /in-person visits are visits 1 and 7/i);
  assert.match(requirement, /complete grouped list/i);
});

test('does not add grouping instructions to ordinary prose questions', () => {
  assert.equal(numberedCategoryGroupingRequirement('Summarize the study objectives.'), '');
});

test('preserves exact negated labels in named regimen comparisons', () => {
  const requirement = namedComparisonLabelRequirement(
    'Which regimens are compared in the sample-size-versus-power figure?',
  );
  assert.match(requirement, /preserve each label exactly/i);
  assert.match(requirement, /including words such as "no"/i);
  assert.match(requirement, /X versus Y/);
});

test('requires named endpoint coverage for compound protocol questions', () => {
  const requirement = evidenceCoverageRequirement(
    'Extract the main intervention objectives/endpoints and explain the visit schedule.',
  );
  assert.match(requirement, /every main objective or endpoint/i);
  assert.match(requirement, /do not replace an outcome endpoint/i);
  assert.match(requirement, /Aim, Objective, or Outcome Measures/i);
  assert.match(requirement, /never relabel table procedures/i);
});

test('requires both sample size and numeric power without substituting FDR', () => {
  const requirement = evidenceCoverageRequirement(
    'Explain the sample-size-versus-power figure and its power statement.',
  );
  assert.match(requirement, /sample size and the numeric statistical power/i);
  assert.match(requirement, /false-discovery-rate/i);
});

test('requires exact schema labels when the user asks for join keys', () => {
  assert.match(
    evidenceCoverageRequirement('Give examples, explaining the join keys used.'),
    /patient_id/,
  );
});

test('requires dashboard headline metrics outside pagination', () => {
  assert.match(
    evidenceCoverageRequirement('Generate a dashboard with dropout rate and missing outcomes.'),
    /visible prose/i,
  );
});
