import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'larkup-video-answer-memory-test-'));
  const originalCwd = process.cwd();
  process.chdir(workDir);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
  }
}

test('video answer memory is exact-question and revision scoped', async () => {
  await withIsolatedWorkspace(async () => {
    const { createProject, runWithProject } = await import('../project-store');
    const {
      getVideoAnswerMemory,
      recordUnansweredVideoQuestion,
      saveVideoAnswerCorrection,
      saveVideoAnswerMemory,
      clearVideoAnswerMemory,
    } = await import('./answer-memory-store');
    const { project } = await createProject('Answer memory');
    await runWithProject(project.id, async () => {
      await saveVideoAnswerMemory({
        mediaAssetId: 'video-a',
        knowledgeRevisionId: 'revision-a',
        question: ' Who won? ',
        answer: { success: true, evidence: [{ evidenceId: 'evidence-a' }] },
        evidenceIds: ['evidence-a'],
      });
      await saveVideoAnswerCorrection({
        mediaAssetId: 'video-a',
        knowledgeRevisionId: 'revision-a',
        question: 'who   won?',
        answer: 'The red team won.',
      });
      const hit = await getVideoAnswerMemory('video-a', 'revision-a', 'WHO WON?');
      assert.equal(hit?.evidenceIds[0], 'evidence-a');
      assert.equal(hit?.userCorrection?.answer, 'The red team won.');
      assert.equal(await getVideoAnswerMemory('video-a', 'revision-b', 'who won?'), undefined);

      await recordUnansweredVideoQuestion({
        mediaAssetId: 'video-a',
        knowledgeRevisionId: 'revision-a',
        question: 'What happens next?',
      });
      await recordUnansweredVideoQuestion({
        mediaAssetId: 'video-a',
        knowledgeRevisionId: 'revision-a',
        question: 'what happens next?',
      });
      const miss = await getVideoAnswerMemory('video-a', 'revision-a', 'WHAT HAPPENS NEXT?');
      assert.equal(miss?.unansweredCount, 2);
      assert.equal(miss?.answer, undefined);

      assert.deepEqual(await clearVideoAnswerMemory('video-a'), { cleared: 2 });
      assert.equal(await getVideoAnswerMemory('video-a', 'revision-a', 'who won?'), undefined);
    });
  });
});
