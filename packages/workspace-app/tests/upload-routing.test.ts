import assert from 'node:assert/strict';
import test from 'node:test';
import { isServerParseable } from '../src/components/data/upload-routing';

test('server-parseable types are routed to background S3 ingestion', () => {
  for (const name of [
    'report.pdf',
    'scan.PDF',
    'notes.docx',
    'data.csv',
    'readme.md',
    'config.toml',
    'records.json',
    'page.html',
    'page.htm',
    'server.log',
    'feed.xml',
    'plain.txt',
  ]) {
    assert.equal(isServerParseable(name), true, `${name} should be server-parseable`);
  }
});

test('types the server cannot parse keep the in-browser path', () => {
  // The worker cannot parse these, so they must not be routed server-side.
  for (const name of ['sheet.xlsx', 'legacy.xls', 'old.doc', 'photo.png', 'movie.mp4']) {
    assert.equal(isServerParseable(name), false, `${name} should not be server-parseable`);
  }
});
