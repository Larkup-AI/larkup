import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  listTabularDatasets: vi.fn(),
  readDocuments: vi.fn(),
  readGroups: vi.fn(),
  readJobs: vi.fn(),
  readMediaAssets: vi.fn(),
  resolveTabularDatasetGroups: vi.fn(),
  updateGroup: vi.fn(),
}));

vi.mock('@larkup/core/groups-store', () => ({
  createGroup: mocks.createGroup,
  deleteGroup: mocks.deleteGroup,
  readGroups: mocks.readGroups,
  updateGroup: mocks.updateGroup,
}));
vi.mock('@larkup/core/documents-store', () => ({ readDocuments: mocks.readDocuments }));
vi.mock('@larkup/core/media-store', () => ({ readMediaAssets: mocks.readMediaAssets }));
vi.mock('@larkup/core/jobs-store', () => ({ readJobs: mocks.readJobs }));
vi.mock('@larkup/core/tabular-store', () => ({
  listTabularDatasets: mocks.listTabularDatasets,
  resolveTabularDatasetGroups: mocks.resolveTabularDatasetGroups,
}));
vi.mock('@larkup/core/project-store', () => ({
  runWithProject: vi.fn((_projectId, operation) => operation()),
}));

import { DELETE, GET } from './route';

const defaultGroup = {
  id: 'default',
  name: 'Default',
  assistantEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const researchGroup = { ...defaultGroup, id: 'research', name: 'Research' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readGroups.mockResolvedValue([defaultGroup, researchGroup]);
  mocks.readDocuments.mockResolvedValue([]);
  mocks.readMediaAssets.mockResolvedValue([]);
  mocks.listTabularDatasets.mockResolvedValue([]);
  mocks.resolveTabularDatasetGroups.mockReturnValue([]);
  mocks.readJobs.mockResolvedValue([]);
});

describe('groups API', () => {
  it('counts each media asset once instead of counting its derived documents', async () => {
    mocks.readDocuments.mockResolvedValue([
      { id: 'text', source: 'text', groupId: 'research' },
      { id: 'media-summary', source: 'media', groupId: 'research' },
      {
        id: 'media-segment',
        source: 'media',
        groupId: 'research',
        parentSourceId: 'media-summary',
      },
    ]);
    mocks.readMediaAssets.mockResolvedValue([{ id: 'video', groupId: 'research' }]);

    const response = await GET(new Request('http://localhost/api/groups'));
    const body = await response.json();

    expect(body.groups).toContainEqual(expect.objectContaining({ id: 'research', sourceCount: 2 }));
  });

  it('refuses to delete a group while stored sources still reference it', async () => {
    mocks.readDocuments.mockResolvedValue([{ id: 'text', source: 'text', groupId: 'research' }]);

    const response = await DELETE(
      new Request('http://localhost/api/groups?id=research', { method: 'DELETE' }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Move or delete this group’s sources before deleting the group.',
    });
    expect(mocks.deleteGroup).not.toHaveBeenCalled();
  });
});
