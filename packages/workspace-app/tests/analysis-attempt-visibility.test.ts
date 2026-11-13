import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isHiddenAnalysisFailure,
  type AnalysisAttemptState,
} from '../src/components/chat/analysis-attempt-visibility';

const analysis = (isFailure: boolean): AnalysisAttemptState => ({
  isAnalysisAttempt: true,
  isFailure,
});

test('a failed analysis attempt is always hidden', () => {
  assert.equal(isHiddenAnalysisFailure(analysis(true)), true);
});

test('a terminal failure with no retry is still hidden', () => {
  // The case where analysis fails and the assistant only emits a text fallback.
  assert.equal(isHiddenAnalysisFailure(analysis(true)), true);
});

test('a successful analysis attempt is shown', () => {
  assert.equal(isHiddenAnalysisFailure(analysis(false)), false);
});

test('a non-analysis part is never treated as a hidden failure', () => {
  assert.equal(isHiddenAnalysisFailure({ isAnalysisAttempt: false, isFailure: true }), false);
  assert.equal(isHiddenAnalysisFailure(undefined), false);
});
