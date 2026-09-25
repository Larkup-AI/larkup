import { test, expect, type APIRequestContext } from '@playwright/test';
import { TEST_PASTE_TEXT } from '../../utils/fixtures';

async function isDataAddingBlocked(request: APIRequestContext) {
  const status = await request.get('/api/index');
  return (await status.json()).blockers?.includes('MISSING_EMBEDDING_API_KEY') ?? false;
}

test.describe('Documents API (/api/documents)', () => {
  let createdDocId: string | null = null;

  test('POST keeps a source linked to its selected group', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );

    const groupResponse = await request.post('/api/groups', {
      data: { name: `E2E group ${Date.now()}`, icon: '◆' },
    });
    expect(groupResponse.status()).toBe(201);
    const group = (await groupResponse.json()).group as { id: string };

    let documentId: string | undefined;
    try {
      const staleGroupResponse = await request.post('/api/documents', {
        data: {
          title: 'Stale group must not fall back',
          content: TEST_PASTE_TEXT,
          source: 'paste',
          groupId: 'deleted-group-id',
        },
      });
      expect(staleGroupResponse.status()).toBe(400);
      expect((await staleGroupResponse.json()).error).toContain('does not exist');

      const createResponse = await request.post('/api/documents', {
        data: {
          title: 'Grouped E2E document',
          content: TEST_PASTE_TEXT,
          source: 'paste',
          groupId: group.id,
        },
      });
      expect(createResponse.status()).toBe(201);
      const document = (await createResponse.json()).document as { id: string; groupId: string };
      documentId = document.id;
      expect(document.groupId).toBe(group.id);

      const malformedGroupResponse = await request.patch('/api/documents', {
        data: { id: document.id, groupId: 'undefined' },
      });
      expect(malformedGroupResponse.status()).toBe(200);
      expect((await malformedGroupResponse.json()).document.groupId).toBe('default');
    } finally {
      if (documentId) await request.delete(`/api/documents?id=${documentId}`).catch(() => {});
      await request.delete(`/api/groups?id=${group.id}`).catch(() => {});
    }
  });

  test('PATCH /api/documents/move moves selected sources between groups', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );

    const suffix = Date.now();
    const sourceGroupResponse = await request.post('/api/groups', {
      data: { name: `Move source ${suffix}`, icon: '◆' },
    });
    const targetGroupResponse = await request.post('/api/groups', {
      data: { name: `Move target ${suffix}`, icon: '●' },
    });
    expect(sourceGroupResponse.status()).toBe(201);
    expect(targetGroupResponse.status()).toBe(201);
    const sourceGroup = (await sourceGroupResponse.json()).group as { id: string };
    const targetGroup = (await targetGroupResponse.json()).group as { id: string };

    let documentId: string | undefined;
    let datasetId: string | undefined;
    try {
      const datasetResponse = await request.post('/api/tabular', {
        data: {
          fileName: 'movable.csv',
          rows: [{ value: 42 }],
          groupId: sourceGroup.id,
        },
      });
      expect(datasetResponse.status()).toBe(200);
      datasetId = (await datasetResponse.json()).id as string;

      const createResponse = await request.post('/api/documents', {
        data: {
          title: 'Movable E2E document',
          content: TEST_PASTE_TEXT,
          source: 'paste',
          groupId: sourceGroup.id,
          metadata: { tabularDatasetId: datasetId },
        },
      });
      expect(createResponse.status()).toBe(201);
      documentId = (await createResponse.json()).document.id as string;

      const moveResponse = await request.patch('/api/documents/move', {
        data: { documentIds: [documentId], mediaAssetIds: [], groupId: targetGroup.id },
      });
      expect(moveResponse.status()).toBe(200);
      const move = await moveResponse.json();
      expect(move.groupId).toBe(targetGroup.id);
      expect(move.movedCount).toBe(1);
      expect(move.documents).toEqual([
        expect.objectContaining({ id: documentId, groupId: targetGroup.id }),
      ]);
      expect(move.tabularDatasets).toEqual([
        expect.objectContaining({ id: datasetId, groupId: targetGroup.id }),
      ]);

      const documents = await request.get('/api/documents');
      expect(documents.status()).toBe(200);
      expect((await documents.json()).documents).toContainEqual(
        expect.objectContaining({ id: documentId, groupId: targetGroup.id }),
      );
      const datasets = await request.get('/api/tabular');
      expect((await datasets.json()).datasets).toContainEqual(
        expect.objectContaining({ id: datasetId, groupId: targetGroup.id }),
      );
    } finally {
      if (documentId) await request.delete(`/api/documents?id=${documentId}`).catch(() => {});
      if (datasetId) await request.delete(`/api/tabular?id=${datasetId}`).catch(() => {});
      await request.delete(`/api/groups?id=${sourceGroup.id}`).catch(() => {});
      await request.delete(`/api/groups?id=${targetGroup.id}`).catch(() => {});
    }
  });

  test('POST /api/documents — blocks valid documents without embedding credentials', async ({
    request,
  }) => {
    test.skip(
      !(await isDataAddingBlocked(request)),
      'Embedding credentials are configured for this run',
    );

    const res = await request.post('/api/documents', {
      data: { title: 'Blocked document', content: TEST_PASTE_TEXT, source: 'paste' },
    });

    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('embedding provider API key');
  });

  test('POST /api/documents — add a document', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    const res = await request.post('/api/documents', {
      data: {
        title: 'E2E API Test Document',
        content: TEST_PASTE_TEXT,
        source: 'paste',
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('document');
    expect(body.document).toHaveProperty('id');
    expect(body.document.title).toBe('E2E API Test Document');
    createdDocId = body.document.id;
    console.log(`  ✓ Document created: ${createdDocId}`);
  });

  test('POST /api/documents — empty content returns 400', async ({ request }) => {
    const res = await request.post('/api/documents', {
      data: {
        title: 'Empty Doc',
        content: '',
        source: 'paste',
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    console.log('  ✓ Empty content correctly rejected (400)');
  });

  test('GET /api/documents — list documents', async ({ request }) => {
    const res = await request.get('/api/documents');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('documents');
    expect(Array.isArray(body.documents)).toBe(true);
    expect(body).toHaveProperty('stats');
    console.log(
      `  ✓ Documents list: ${body.documents.length} docs, ${body.stats?.docCount ?? '?'} total`,
    );
  });

  test('PATCH /api/documents — update a document', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    // First create a doc to update
    const createRes = await request.post('/api/documents', {
      data: {
        title: 'To Be Updated',
        content: 'Original content for patch test',
        source: 'paste',
      },
    });
    const { document } = await createRes.json();

    const res = await request.patch('/api/documents', {
      data: {
        id: document.id,
        title: 'Updated Title',
        content: 'Updated content via E2E test',
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.document.title).toBe('Updated Title');
    console.log(`  ✓ Document updated: ${document.id}`);

    // Cleanup
    await request.delete(`/api/documents?id=${document.id}`);
  });

  test('PATCH /api/documents — missing id returns 400', async ({ request }) => {
    const res = await request.patch('/api/documents', {
      data: { title: 'No ID' },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('id');
    console.log('  ✓ Missing id correctly rejected (400)');
  });

  test('DELETE /api/documents?id=x — delete one document', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    // Create a doc to delete
    const createRes = await request.post('/api/documents', {
      data: {
        title: 'To Be Deleted',
        content: 'This doc will be deleted in E2E test',
        source: 'paste',
      },
    });
    const { document } = await createRes.json();

    const res = await request.delete(`/api/documents?id=${document.id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const remaining = await request.get('/api/documents');
    expect(remaining.status()).toBe(200);
    expect((await remaining.json()).documents).not.toContainEqual(
      expect.objectContaining({ id: document.id }),
    );
    console.log(`  ✓ Document deleted: ${document.id}`);
  });

  test('DELETE /api/documents?id=x — missing document returns 404', async ({ request }) => {
    const res = await request.delete('/api/documents?id=does-not-exist');
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toContain('not found');
  });

  test('DELETE /api/documents?ids=a,b — delete multiple', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    // Create two docs
    const doc1 = await (
      await request.post('/api/documents', {
        data: {
          title: 'Batch Delete 1',
          content: 'Batch delete test 1',
          source: 'paste',
        },
      })
    ).json();
    const doc2 = await (
      await request.post('/api/documents', {
        data: {
          title: 'Batch Delete 2',
          content: 'Batch delete test 2',
          source: 'paste',
        },
      })
    ).json();

    const ids = `${doc1.document.id},${doc2.document.id}`;
    const res = await request.delete(`/api/documents?ids=${ids}`);
    expect(res.status()).toBe(200);
    console.log('  ✓ Batch delete successful');
  });

  // Cleanup the doc created in the first test
  test.afterAll(async ({ request }) => {
    if (createdDocId) {
      await request.delete(`/api/documents?id=${createdDocId}`).catch(() => {});
    }
  });
});
