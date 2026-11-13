import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  VIDEO_MEDIA_EVIDENCE_INSTRUCTION,
  VIDEO_QUERY_PLANNER_SYSTEM,
  VIDEO_QUERY_PLANNER_RECOVERY_SYSTEM,
  VIDEO_SOURCE_POSITION_CLASSIFIER_SYSTEM,
} from '../src/lib/chat/video-planning-prompts';
import { pdfPageExtractionPrompt } from '../src/lib/chat/pdf-extraction-prompt';
import { buildDocumentSessionContext } from '../src/lib/chat/document-session-context';
import {
  NO_SOURCE_EVIDENCE_NOTICE,
  mediaSourceLocatedNotice,
  FINAL_ANSWER_COMPLETENESS_NUDGE,
} from '../src/lib/chat/evidence-guidance-prompts';

/**
 * These model-facing prompts were lifted out of the chat route into dedicated
 * modules. The extraction must stay behavior-preserving: the exact text handed
 * to a model may only change through the benchmark regression gate, never by
 * accident. This locks every extracted prompt to the golden snapshot captured
 * at extraction time. Regenerate the fixture intentionally (reviewing the diff)
 * once a prompt change has been validated.
 */
const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures-model-prompts.golden.json', import.meta.url)),
    'utf8',
  ),
);

test('video planning prompts match the golden snapshot', () => {
  assert.equal(VIDEO_MEDIA_EVIDENCE_INSTRUCTION, golden.VIDEO_MEDIA_EVIDENCE_INSTRUCTION);
  assert.equal(VIDEO_QUERY_PLANNER_SYSTEM, golden.VIDEO_QUERY_PLANNER_SYSTEM);
  assert.equal(VIDEO_QUERY_PLANNER_RECOVERY_SYSTEM, golden.VIDEO_QUERY_PLANNER_RECOVERY_SYSTEM);
  assert.equal(
    VIDEO_SOURCE_POSITION_CLASSIFIER_SYSTEM,
    golden.VIDEO_SOURCE_POSITION_CLASSIFIER_SYSTEM,
  );
});

test('pdf page extraction prompt matches the golden snapshot', () => {
  assert.equal(pdfPageExtractionPrompt(golden.SAMPLE_QUESTION), golden.pdfPageExtractionPrompt);
});

test('document session context matches the golden snapshot', () => {
  assert.equal(
    buildDocumentSessionContext(golden.SAMPLE_DOC_SESSION, golden.SAMPLE_DOC_FIELDS),
    golden.documentSessionContext,
  );
  // No active session yields no context block.
  assert.equal(buildDocumentSessionContext(undefined, golden.SAMPLE_DOC_FIELDS), '');
});

test('evidence guidance prompts match the golden snapshot', () => {
  assert.equal(NO_SOURCE_EVIDENCE_NOTICE, golden.NO_SOURCE_EVIDENCE_NOTICE);
  assert.equal(
    mediaSourceLocatedNotice(golden.SAMPLE_MEDIA_ASSET),
    golden.mediaSourceLocatedNotice,
  );
  assert.equal(FINAL_ANSWER_COMPLETENESS_NUDGE, golden.FINAL_ANSWER_COMPLETENESS_NUDGE);
});
