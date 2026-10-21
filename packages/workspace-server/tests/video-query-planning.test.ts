import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileVideoInvestigation } from '../src/lib/chat/video-query-planning.ts';
import { collectExhaustiveVideoEvidencePages } from '../src/lib/chat/video-rag-routing.ts';

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

test('a long source inventory follows every opaque cursor into one renderable table', async () => {
  const allRows = Array.from({ length: 125 }, (_, index) => ({
    id: `segment-${index}`,
    timestamp: index * 30,
    text: `Lecture segment ${index}`,
  }));
  const page = (cursor: number) => ({
    success: true,
    columns: ['timestamp', 'text'],
    rows: allRows.slice(cursor, cursor + 48),
    evidence: [],
    inventory: { recordSet: 'speech', coverage: { complete: true } },
    continuation: {
      exhaustive: true,
      hasMore: cursor + 48 < allRows.length,
      ...(cursor + 48 < allRows.length ? { nextCursor: cursor + 48 } : {}),
      totalItems: allRows.length,
    },
  });
  const calls: number[] = [];

  const result = (await collectExhaustiveVideoEvidencePages(
    async (input) => {
      const cursor = Number(input.cursor ?? 0);
      calls.push(cursor);
      return page(cursor);
    },
    { mediaAssetId: 'lecture-1', query: 'Give me the full lecture transcript.' },
    page(0),
    'tool-call-1',
  )) as any;

  assert.deepEqual(calls, [48, 96]);
  assert.equal(result.rows.length, 125);
  assert.equal(result.totalRows, 125);
  assert.equal(result.rows[124].text, 'Lecture segment 124');
  assert.equal(result.continuation.hasMore, false);
  assert.equal(result.continuation.contextLimitReached, false);
});
