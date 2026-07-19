import { test, expect } from '@playwright/test';
import { TEST_PASTE_TEXT } from '../../utils/fixtures';

test.describe('Documents API (/api/documents)', () => {
  let createdDocId: string | null = null;

  test('POST /api/documents — add a document', async ({ request }) => {
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
    console.log(`  ✓ Document deleted: ${document.id}`);
  });

  test('DELETE /api/documents?ids=a,b — delete multiple', async ({ request }) => {
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
