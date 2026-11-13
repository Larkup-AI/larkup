import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupersededAnalysisFailure,
  type AnalysisAttemptState,
} from '../src/components/chat/analysis-attempt-visibility';

const analysis = (isFailure: boolean): AnalysisAttemptState => ({
  isAnalysisAttempt: true,
  isFailure,
});
const other: AnalysisAttemptState = { isAnalysisAttempt: false, isFailure: false };

test('a failed attempt is hidden when a later attempt has succeeded', () => {
  const parts = [analysis(true), analysis(false)];
  assert.equal(isSupersededAnalysisFailure(parts, 0), true);
  assert.equal(isSupersededAnalysisFailure(parts, 1), false);
});

test('a failed attempt is hidden while a later attempt is still running', () => {
  // The later attempt is running, so it is not marked as a failure yet.
  const parts = [analysis(true), analysis(false)];
  assert.equal(isSupersededAnalysisFailure(parts, 0), true);
});

test('the only/last attempt is shown even when it failed', () => {
  assert.equal(isSupersededAnalysisFailure([analysis(true)], 0), false);
  const twoFails = [analysis(true), analysis(true)];
  assert.equal(isSupersededAnalysisFailure(twoFails, 0), true, 'earlier failure hidden');
  assert.equal(isSupersededAnalysisFailure(twoFails, 1), false, 'final failure shown');
});

test('a successful attempt is never hidden', () => {
  const parts = [analysis(false), analysis(true)];
  assert.equal(isSupersededAnalysisFailure(parts, 0), false);
});

test('non-analysis parts between attempts do not affect suppression', () => {
  const parts = [analysis(true), other, analysis(false)];
  assert.equal(isSupersededAnalysisFailure(parts, 0), true);
  assert.equal(isSupersededAnalysisFailure(parts, 1), false);
});
