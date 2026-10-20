import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileVideoInvestigation } from '../src/lib/chat/video-query-planning.ts';

test('settled outcomes override an incorrect broad synthesis plan', () => {
  assert.deepEqual(
    reconcileVideoInvestigation(
      { scope: 'source', goal: 'synthesize' },
      { hasPosition: false, asksForSettledOutcome: true },
    ),
    { scope: 'temporal', goal: 'resolve' },
  );
});

test('a status at a specified position remains bounded rather than becoming a final outcome', () => {
  assert.deepEqual(
    reconcileVideoInvestigation(
      {
        scope: 'focused',
        goal: 'answer',
        timeRange: { startSecs: 840, endSecs: 850 },
      },
      { hasPosition: true, asksForSettledOutcome: false },
    ),
    {
      scope: 'focused',
      goal: 'answer',
      timeRange: { startSecs: 840, endSecs: 850 },
    },
  );
});

test('cross-position appearance tracing preserves its bounded visual ledger', () => {
  assert.deepEqual(
    reconcileVideoInvestigation(
      {
        scope: 'focused',
        goal: 'answer',
        timeRange: { startSecs: 60, endSecs: 70 },
      },
      { hasPosition: true, connectsBeyondPosition: true },
    ),
    {
      scope: 'temporal',
      goal: 'trace',
      evidence: ['visual'],
      recordSet: 'observed',
      timeRange: { startSecs: 60, endSecs: 70 },
    },
  );
});
