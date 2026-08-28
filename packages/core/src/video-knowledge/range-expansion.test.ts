import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * project-store.ts resolves its data root from process.cwd() at import
 * time, so this chdir's into an isolated temp directory before the first
 * dynamic import -- never touches this repo's own .larkup/ workspace.
 */
async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'larkup-video-knowledge-test-'));
  const originalCwd = process.cwd();
  process.chdir(workDir);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
  }
}

test('expandInvestigationRange', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { mutateVideoKnowledgeState } = await import('./store');
    const { expandInvestigationRange } = await import('./range-expansion');
    const { DEFAULT_VIDEO_CONFIDENCE } = await import('./types');

    const { project } = await createProject('Range Expansion Test');

    await runWithProject(project.id, async () => {
      const mediaAssetId = 'asset-1';
      const unstructuredAssetId = 'asset-2';
      const revisionId = 'rev-1';
      const createdAt = new Date().toISOString();

      await mutateVideoKnowledgeState((state) => {
        state.manifests.push({
          id: 'manifest-1',
          mediaAssetId,
          knowledgeRevisionId: revisionId,
          activeEvidenceRevisionIds: {},
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        });
        // No scenes/chapters indexed yet for this asset -- exercises the
        // padding fallback with nothing structural to expand into.
        state.manifests.push({
          id: 'manifest-2',
          mediaAssetId: unstructuredAssetId,
          knowledgeRevisionId: 'rev-2',
          activeEvidenceRevisionIds: {},
          activeObservationRevisionIds: {},
          activeProjectionIds: [],
          activationReason: 'initial',
          schemaVersion: 1,
          createdAt,
          activatedAt: createdAt,
        });
        state.scenes.push({
          id: 'scene-1',
          lineageId: 'scene-1',
          mediaAssetId,
          knowledgeRevisionId: revisionId,
          title: 'The handoff',
          timeRange: { startSecs: 30, endSecs: 90, precision: 'segment' },
          eventLineageIds: [],
          evidenceLineageIds: [],
          quality: DEFAULT_VIDEO_CONFIDENCE,
          capabilities: [],
          schemaVersion: 1,
          createdAt,
        });
        state.chapters.push({
          id: 'chapter-1',
          lineageId: 'chapter-1',
          mediaAssetId,
          knowledgeRevisionId: revisionId,
          title: 'Act two',
          timeRange: { startSecs: 0, endSecs: 600, precision: 'segment' },
          sceneLineageIds: ['scene-1'],
          eventLineageIds: [],
          evidenceLineageIds: [],
          quality: DEFAULT_VIDEO_CONFIDENCE,
          schemaVersion: 1,
          createdAt,
        });
      });

      await test('expands a narrow range to its enclosing scene first', async () => {
        const result = await expandInvestigationRange(mediaAssetId, {
          startSecs: 40,
          endSecs: 50,
        });
        assert.equal(result?.basis, 'scene');
        assert.deepEqual(result?.expanded, { startSecs: 30, endSecs: 90 });
      });

      await test('expands to the enclosing chapter when no scene contains the range', async () => {
        const result = await expandInvestigationRange(mediaAssetId, {
          startSecs: 200,
          endSecs: 210,
        });
        assert.equal(result?.basis, 'chapter');
        assert.deepEqual(result?.expanded, { startSecs: 0, endSecs: 600 });
      });

      await test('pads by a fixed amount, clamped to the video duration, with no enclosing structure', async () => {
        const result = await expandInvestigationRange(
          unstructuredAssetId,
          { startSecs: 590, endSecs: 595 },
          600,
        );
        assert.equal(result?.basis, 'padding');
        assert.equal(result?.expanded.endSecs, 600);
        assert.ok(result!.expanded.startSecs < 590);
      });

      await test('returns undefined for an asset with no active manifest', async () => {
        const result = await expandInvestigationRange('unknown-asset', {
          startSecs: 0,
          endSecs: 10,
        });
        assert.equal(result, undefined);
      });
    });
  });
});
