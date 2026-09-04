import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isRunning: vi.fn(),
  readRun: vi.fn(),
  readDocuments: vi.fn(),
  corpusStats: vi.fn(),
  createRun: vi.fn(),
  runIndexer: vi.fn(),
}));

vi.mock('@larkup/core/config-store', () => ({ readConfig: vi.fn() }));
vi.mock('@larkup/core/documents-store', () => ({
  corpusStats: mocks.corpusStats,
  readDocuments: mocks.readDocuments,
}));
vi.mock('@larkup/core/index-store', () => ({
  isRunning: mocks.isRunning,
  readRun: mocks.readRun,
}));
vi.mock('@larkup/core/indexing/indexer', () => ({
  createRun: mocks.createRun,
  runIndexer: mocks.runIndexer,
}));
vi.mock('@larkup/core/embeddings/registry', () => ({ getEmbeddingModel: vi.fn() }));
vi.mock('@larkup/core/project-store', () => ({
  runWithProject: vi.fn((_projectId, operation) => operation()),
}));

import { POST } from './route';

describe('index queue API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readRun.mockResolvedValue({ id: 'active-run', status: 'embedding' });
    mocks.readDocuments.mockResolvedValue([]);
    mocks.corpusStats.mockResolvedValue({ docCount: 0, charCount: 0 });
  });

  it('queues another pass instead of rejecting files added during indexing', async () => {
    mocks.isRunning.mockResolvedValueOnce(true).mockResolvedValue(false);

    const response = await POST(
      new Request('http://localhost/api/index', { method: 'POST', body: '{}' }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      queued: true,
      run: { id: 'active-run' },
    });
    await vi.waitFor(() => expect(mocks.readDocuments).toHaveBeenCalled());
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});
