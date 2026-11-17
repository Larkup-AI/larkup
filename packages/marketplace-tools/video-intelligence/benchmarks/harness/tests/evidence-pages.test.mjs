import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidencePages } from '../evidence-pages.mjs';
test('source evidence beyond four pages is read without another paid inspection', async () => {
  const seen=[];
  const result=await collectEvidencePages(async (cursor=0) => {
    seen.push(cursor);
    return {success:true,records:[`record-${cursor}`],continuation:{hasMore:cursor<240,nextCursor:cursor+48}};
  });
  assert.equal(result.success,true);assert.equal(result.pages.length,6);
  assert.deepEqual(seen,[0,48,96,144,192,240]);
});
test('unresolved paging never becomes a scored evidence absence', async () => {
  for (const result of [
    await collectEvidencePages(async () => ({success:true,continuation:{hasMore:true,nextCursor:0}})),
    await collectEvidencePages(async () => ({success:true,continuation:{hasMore:true}})),
    await collectEvidencePages(async () => ({success:true,continuation:{hasMore:true,nextCursor:1}}),{maxPages:1})
  ]) {assert.equal(result.success,false);assert.equal(result.toolExecutionValid,false);}
});
