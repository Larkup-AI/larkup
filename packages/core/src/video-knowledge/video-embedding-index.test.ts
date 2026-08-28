import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * config-store/project-store resolve their data roots from process.cwd()
 * at call time and LanceDB's default dbPath ("./.larkup/lancedb") is
 * relative, so chdir'ing into an isolated temp directory before running
 * keeps this test fully local and never touches this repo's own state.
 */
async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'larkup-video-embedding-test-'));
  const originalCwd = process.cwd();
  process.chdir(workDir);
  try {
    return await run();
  } finally {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Stands in for DashScope's multimodal-embedding endpoint. */
function startFixedVectorServer(vector: number[]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: { embeddings: [{ embedding: vector }] } }));
        void body;
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

test('video-embedding-index', async () => {
  await withIsolatedWorkspace(async () => {
    const { runWithProject, createProject } = await import('../project-store');
    const { upsertVideoEmbeddings, queryVideoEmbeddings } = await import(
      './video-embedding-index'
    );

    const { project } = await createProject('Video Embedding Test');

    await runWithProject(project.id, async () => {
      await test('upsert then query round-trips through the real lancedb adapter, filtered by mediaAssetId', async () => {
        await upsertVideoEmbeddings('asset-a', 'rev-1', [
          { clipId: 'clip_0', startSecs: 0, endSecs: 8, vector: [1, 0, 0, 0], provider: 'qwen3-vl-embedding' },
          { clipId: 'clip_1', startSecs: 8, endSecs: 16, vector: [0, 1, 0, 0], provider: 'qwen3-vl-embedding' },
        ]);
        await upsertVideoEmbeddings('asset-b', 'rev-1', [
          { clipId: 'clip_0', startSecs: 0, endSecs: 8, vector: [0, 0, 1, 0], provider: 'qwen3-vl-embedding' },
        ]);

        const { url, server } = await startFixedVectorServer([1, 0, 0, 0]);
        const previousKey = process.env.DASHSCOPE_API_KEY;
        const previousUrl = process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL;
        process.env.DASHSCOPE_API_KEY = 'test-key';
        process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL = url;
        try {
          const hits = await queryVideoEmbeddings('asset-a', 'someone raises their hand', 5);
          assert.ok(hits.length > 0);
          assert.equal(hits[0].clipId, 'clip_0');
          assert.equal(hits[0].startSecs, 0);
          assert.equal(hits[0].endSecs, 8);
        } finally {
          server.close();
          if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
          else process.env.DASHSCOPE_API_KEY = previousKey;
          if (previousUrl === undefined) delete process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL;
          else process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL = previousUrl;
        }
      });

      await test('returns no hits when DASHSCOPE_API_KEY is not configured', async () => {
        const previous = process.env.DASHSCOPE_API_KEY;
        delete process.env.DASHSCOPE_API_KEY;
        try {
          const hits = await queryVideoEmbeddings('asset-a', 'anything', 5);
          assert.deepEqual(hits, []);
        } finally {
          if (previous !== undefined) process.env.DASHSCOPE_API_KEY = previous;
        }
      });

      await test('returns no hits (not an error) when the embedding endpoint is unreachable', async () => {
        const previousKey = process.env.DASHSCOPE_API_KEY;
        const previousUrl = process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL;
        process.env.DASHSCOPE_API_KEY = 'test-key';
        process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL = 'http://127.0.0.1:1/does-not-exist';
        try {
          const hits = await queryVideoEmbeddings('asset-a', 'anything', 5);
          assert.deepEqual(hits, []);
        } finally {
          if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
          else process.env.DASHSCOPE_API_KEY = previousKey;
          if (previousUrl === undefined) delete process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL;
          else process.env.LARKUP_VIDEO_DASHSCOPE_BASE_URL = previousUrl;
        }
      });

      await test('upsert of an empty list is a safe no-op', async () => {
        await upsertVideoEmbeddings('asset-c', 'rev-1', []);
      });
    });
  });
});
