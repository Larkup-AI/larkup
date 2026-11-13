import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandResearchPassage,
  rerankResearchCandidates,
  researchRerankingModel,
  researchPdfPagePassages,
  researchCandidatePool,
  verifiedResearchIndices,
} from '../src/lib/chat/research-reranking';

const pool = Array.from({ length: 80 }, (_, index) => ({
  title: `Source ${index}`,
  text: `Evidence ${index}`,
}));
test('a compound question can select a complementary definition below the first matches', async () => {
  const result = await rerankResearchCandidates(
    'Reconcile the different metric definitions',
    pool,
    4,
    async (prompt) => {
      const request = JSON.parse(prompt);
      assert.equal(request.passages.length, 64);
      return '[21,0,4]';
    },
  );
  assert.equal(result[0], pool[21]);
  assert.deepEqual(result, [pool[21], pool[0], pool[4]]);
});
test('malformed and invented locators leave deterministic ranking intact', async () => {
  for (const value of ['[999]', '[1.5]', '{"answer":"made up"}', 'not JSON']) {
    assert.equal(
      await rerankResearchCandidates('Compare definitions', pool, 4, async () => value),
      pool,
    );
  }
});
test('a simple question does not spend a reranking model call', async () => {
  assert.equal(
    await rerankResearchCandidates('What is the report title?', pool, 4, async () => {
      throw new Error('unnecessary model call');
    }),
    pool,
  );
});

test('an explicitly empty evidence selection does not resurrect rejected passages', async () => {
  assert.deepEqual(
    await rerankResearchCandidates('Compare definitions', pool, 4, async () => '[]'),
    [],
  );
});

test('reranking sees definitions after long introductory material in a chunk', async () => {
  const candidates = pool.map((p) => ({
    ...p,
    text: 'intro '.repeat(500) + 'source definition at the end',
  }));
  await rerankResearchCandidates(
    'Find original source definitions',
    candidates,
    4,
    async (prompt) => {
      assert.ok(JSON.parse(prompt).passages[0].text.includes('source definition at the end'));
      return '[0]';
    },
  );
});

test('passage expansion recovers source definitions across chunk boundaries', () => {
  const source =
    'header '.repeat(1000) +
    'Primary registry: Authority A. ' +
    'Secondary registry: Authority B.' +
    ' appendix'.repeat(1000);
  const chunk = 'Secondary registry: Authority B.';
  const expanded = expandResearchPassage(chunk, source);
  assert.ok(expanded.includes('Primary registry: Authority A.'));
  assert.ok(expanded.includes(chunk));
  assert.ok(expanded.length <= 6000);
  assert.equal(
    expandResearchPassage('not an exact source excerpt', source),
    'not an exact source excerpt',
  );
});

test('research honors the selected model rather than substituting a cheaper planner', () => {
  assert.equal(researchRerankingModel('vercel_ai_gateway', 'vendor/chosen'), 'vendor/chosen');
});

test('passage expansion accepts whitespace-normalized index boundaries without fuzzy matching', () => {
  const result = expandResearchPassage(
    'Second registry. Remaining context.',
    'First registry.\nSecond registry.\nRemaining context.',
  );
  assert.ok(result.startsWith('First registry.'));
});

test('page annotations preserve a complete figure with its page locator', () => {
  const pages = researchPdfPagePassages(
    'Original text\nPage image analysis:\nPage 7: First figure values 12 and 18.\n\nPage 8: Different figure values 4 and 9.',
  );
  assert.deepEqual(pages, [
    { pageNumber: 7, text: 'Page 7: First figure values 12 and 18.' },
    { pageNumber: 8, text: 'Page 8: Different figure values 4 and 9.' },
  ]);
});

test('overlapping chunks cannot crowd complete page evidence out of the reranking pool', () => {
  const chunks = Array.from({ length: 100 }, (_, id) => ({ id }));
  const page = { id: 1000 };
  const pool = researchCandidatePool(chunks, [page]);
  assert.equal(pool.length, 64);
  assert.ok(pool.includes(page));
});

test('evidence quotes recover misnumbered locators and reject fabricated evidence', () => {
  const passages = [
    { text: 'Grid consumption includes losses.' },
    { text: 'Public generation excludes own consumption.' },
  ];
  assert.deepEqual(
    verifiedResearchIndices(
      [
        { index: 0, quote: 'Public generation excludes own consumption.' },
        { index: 1, quote: 'Invented data not present.' },
      ],
      passages,
    ),
    [1],
  );
});

test('figure headings survive as searchable page metadata', () => {
  const [page] = researchPdfPagePassages(
    'Page 7: ### Retrieval Notes\n**Title:** Public infrastructure totals\n**Year:** 2024',
  );
  assert.equal(page.heading, 'Public infrastructure totals');
  assert.equal(page.pageNumber, 7);
});
