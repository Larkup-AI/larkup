import { expect, test } from '@playwright/test';

test.describe('Groups API (/api/groups)', () => {
  test('renames and deletes an empty group', async ({ request }) => {
    const projectResponse = await request.post('/api/projects', {
      data: { name: `Groups API project ${Date.now()}` },
    });
    expect(projectResponse.status()).toBe(201);
    const projectId = (await projectResponse.json()).project.id as string;
    const groupsUrl = `/api/groups?projectId=${encodeURIComponent(projectId)}`;
    const createResponse = await request.post(groupsUrl, {
      data: { name: `Group API ${Date.now()}`, icon: '◆' },
    });
    expect(createResponse.status()).toBe(201);
    const group = (await createResponse.json()).group as { id: string };

    try {
      const renameResponse = await request.patch(groupsUrl, {
        data: { id: group.id, name: 'Renamed API group' },
      });
      expect(renameResponse.ok()).toBe(true);
      expect((await renameResponse.json()).group.name).toBe('Renamed API group');

      const deleteResponse = await request.delete(
        `${groupsUrl}&id=${encodeURIComponent(group.id)}`,
      );
      expect(deleteResponse.ok()).toBe(true);

      const listResponse = await request.get(groupsUrl);
      expect((await listResponse.json()).groups).not.toContainEqual(
        expect.objectContaining({ id: group.id }),
      );
    } finally {
      await request.delete(`/api/projects?id=${encodeURIComponent(projectId)}`).catch(() => {});
    }
  });

  test('protects the Default group from deletion', async ({ request }) => {
    const response = await request.delete('/api/groups?id=default');

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('cannot be deleted');
  });
});
