import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DOCUMENT_CONTENT,
  splitDocumentPayload,
  type DocumentPayload,
} from '../src/components/data/document-chunking';

const base: Omit<DocumentPayload, 'content'> = {
  title: 'report',
  source: 'files',
  metadata: { fileName: 'report.csv', rowCount: 3 },
};

test('content within the cap is returned unchanged as a single document', () => {
  const payload: DocumentPayload = { ...base, content: 'row one\nrow two' };
  const parts = splitDocumentPayload(payload);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].title, 'report');
  assert.equal(parts[0].content, payload.content);
  assert.equal((parts[0].metadata as Record<string, unknown>).part, undefined);
});

test('a structured document over the cap is split into ordered parts that each fit', () => {
  // A wide tabular file whose joined rows exceed the documents API limit — the
  // case that previously failed the POST and produced an empty corpus.
  const row = `${'col: value, '.repeat(40)}`.trim();
  const rows = Array.from({ length: 2_000 }, () => row).join('\n');
  assert.ok(rows.length > MAX_DOCUMENT_CONTENT, 'fixture must exceed the cap');

  const parts = splitDocumentPayload({ ...base, content: rows });

  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(part.content.length <= MAX_DOCUMENT_CONTENT);
  }
  // Every row is preserved across the parts, none dropped or duplicated.
  const original = rows.split('\n');
  const recombined = parts.flatMap((p) => p.content.split('\n'));
  assert.deepEqual(recombined, original);
  // Parts are labeled and numbered so the corpus shows their provenance.
  assert.match(parts[0].title, /report \(part 1 of \d+\)/);
  assert.equal((parts[0].metadata as Record<string, unknown>).part, 1);
  assert.equal((parts[0].metadata as Record<string, unknown>).partCount, parts.length);
});

test('a single line longer than the cap is hard-sliced without data loss', () => {
  const giant = 'x'.repeat(MAX_DOCUMENT_CONTENT * 2 + 17);
  const parts = splitDocumentPayload({ ...base, content: giant });
  assert.ok(parts.every((p) => p.content.length <= MAX_DOCUMENT_CONTENT));
  assert.equal(parts.map((p) => p.content).join(''), giant);
});
