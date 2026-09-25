import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('grounded answer cache is exact-question, project, and source-scope aware', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'larkup-grounded-answer-cache-'));
  const originalDataDirectory = process.env.LARKUP_DATA_DIR;
  process.env.LARKUP_DATA_DIR = dataDirectory;
  try {
    const { runWithProject } = await import('./project-store');
    const {
      deleteGroundedAnswerCacheEntry,
      getGroundedAnswerCacheEntry,
      saveGroundedAnswerDislike,
      saveGroundedAnswerCacheEntry,
    } = await import('./grounded-answer-cache');
    const firstProject = { id: 'first-project', name: 'First cache', port: 8080 };
    const secondProject = { id: 'second-project', name: 'Second cache', port: 8081 };
    await Promise.all(
      [firstProject, secondProject].map(async (project) => {
        const directory = path.join(dataDirectory, 'projects', project.id);
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, 'project.json'),
          JSON.stringify({
            ...project,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }),
        );
      }),
    );

    await runWithProject(firstProject.id, async () => {
      await saveGroundedAnswerCacheEntry({
        question: ' What is my favorite anime? ',
        answer: 'Naruto.',
        sourceScopeFingerprint: 'scope-1',
      });
      const hit = await getGroundedAnswerCacheEntry('WHAT   IS MY FAVORITE ANIME?');
      assert.equal(hit?.answer, 'Naruto.');
      assert.equal(hit?.feedback, 'liked');
      assert.equal(hit?.sourceScopeFingerprint, 'scope-1');

      await saveGroundedAnswerDislike({
        question: 'what is my favorite anime?',
        sourceScopeFingerprint: 'scope-1',
      });
      const disliked = await getGroundedAnswerCacheEntry('What is my favorite anime?');
      assert.equal(disliked?.feedback, 'disliked');
      assert.equal(disliked?.answer, undefined);
    });

    await runWithProject(secondProject.id, async () => {
      assert.equal(await getGroundedAnswerCacheEntry('What is my favorite anime?'), undefined);
    });

    await runWithProject(firstProject.id, async () => {
      assert.equal(await deleteGroundedAnswerCacheEntry('what is my favorite anime?'), true);
      assert.equal(await getGroundedAnswerCacheEntry('What is my favorite anime?'), undefined);
    });
  } finally {
    if (originalDataDirectory === undefined) delete process.env.LARKUP_DATA_DIR;
    else process.env.LARKUP_DATA_DIR = originalDataDirectory;
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
