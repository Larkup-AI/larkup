import assert from 'node:assert/strict';
import test from 'node:test';
import { formatExhaustiveMediaAnswer } from '../src/lib/chat/tool-context.ts';

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
