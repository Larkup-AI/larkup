import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactToolContextForModel,
  formatExhaustiveMediaAnswer,
} from '../src/lib/chat/tool-context.ts';

const rows = Array.from({ length: 64 }, (_, index) => ({
  id: `observation-${index}`,
  Timestamp: index,
  Content: `Observed state ${index}`,
}));
const mixedInventory = {
  success: true,
  inventory: { recordSet: 'all', coverage: { complete: true } },
  columns: ['Timestamp', 'Content'],
  rows,
  evidence: rows.map((row) => ({
    timeRange: { startSecs: row.Timestamp },
    payload: { text: row.Content },
  })),
  claimVerification: { status: 'directly-established' },
  continuation: { exhaustive: true, hasMore: false },
};

test('a complete mixed evidence scan remains input to answer synthesis in every language', () => {
  for (const question of [
    'Describe the attributes, actions and outcome.',
    'اشرح الصفات والأفعال والنتيجة.',
  ]) {
    assert.equal(formatExhaustiveMediaAnswer(mixedInventory, question), undefined);
  }
});

test('an explicit source enumeration of raw evidence still needs an answer rather than a record count', () => {
  assert.equal(
    formatExhaustiveMediaAnswer(
      {
        ...mixedInventory,
        investigation: { directive: { scope: 'source', goal: 'enumerate', recordSet: 'all' } },
      },
      'Explain every observed change and its outcome.',
    ),
    undefined,
  );
});

test('an authored inventory remains a final table without reconstructing missing source items', () => {
  const answer = formatExhaustiveMediaAnswer(
    {
      ...mixedInventory,
      inventory: {
        recordSet: 'source-questions',
        coverage: { complete: false, reason: 'An interval is missing.' },
      },
    },
    'List all source-authored questions.',
  );
  assert.match(answer ?? '', /64 indexed source-questions records/);
  assert.match(answer ?? '', /not a guarantee of complete source coverage/);
});

test('media evidence delivered to the answer model includes an explicit source clock', () => {
  const messages = compactToolContextForModel([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'queryVideoEvidence',
          output: {
            success: true,
            mediaAssetId: 'independent-source',
            evidence: [
              {
                id: 'speech-1',
                modality: 'transcript',
                timeRange: { startSecs: 13.25, endSecs: 29.9 },
                payload: { text: 'An explanation.' },
              },
            ],
          },
        },
      ],
    },
  ]);
  const output = messages[0].content[0].output;
  assert.equal(output.timeRangeUnit, 'seconds');
  assert.equal(output.evidence[0].sourceTimestamp, '0:13–0:29');
  assert.equal(output.evidence[0].timeRange.startSecs, 13.25);
});
