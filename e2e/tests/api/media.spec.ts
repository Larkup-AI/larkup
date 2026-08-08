import { expect, test, type APIRequestContext } from '@playwright/test';

async function isDataAddingBlocked(request: APIRequestContext) {
  const status = await request.get('/api/index');
  return (await status.json()).blockers?.includes('MISSING_EMBEDDING_API_KEY') ?? false;
}

function createSilentWav(durationSecs = 1, sampleRate = 8_000): Buffer {
  const dataLength = durationSecs * sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

test.describe('Media API (/api/media)', () => {
  let assetId: string | undefined;
  const fileName = `e2e-audio-${Date.now()}.wav`;

  test('blocks media uploads without embedding credentials', async ({ request }) => {
    test.skip(
      !(await isDataAddingBlocked(request)),
      'Embedding credentials are configured for this run',
    );

    const upload = await request.post('/api/media', {
      multipart: {
        file: {
          name: fileName,
          mimeType: 'audio/wav',
          buffer: createSilentWav(),
        },
      },
    });

    expect(upload.status()).toBe(409);
    expect((await upload.json()).error).toContain('embedding provider API key');
  });

  test('uploads audio, lists metadata, and serves byte ranges', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    const upload = await request.post('/api/media', {
      multipart: {
        file: {
          name: fileName,
          mimeType: 'audio/wav',
          buffer: createSilentWav(),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const uploadBody = await upload.json();
    expect(uploadBody.count).toBe(1);
    expect(uploadBody.assets[0]).toMatchObject({
      fileName,
      type: 'audio',
      processingStatus: 'pending',
    });
    assetId = uploadBody.assets[0].id;

    const list = await request.get('/api/media?type=audio');
    expect(list.ok()).toBe(true);
    const listBody = await list.json();
    expect(listBody.assets.some((asset: { id: string }) => asset.id === assetId)).toBe(true);

    const range = await request.get(`/api/media/${assetId}`, {
      headers: { Range: 'bytes=0-43' },
    });
    expect(range.status()).toBe(206);
    expect(range.headers()['accept-ranges']).toBe('bytes');
    expect(range.headers()['content-range']).toContain('/');
    expect((await range.body()).length).toBe(44);
  });

  test('rejects remote URL imports larger than the batch limit', async ({ request }) => {
    const response = await request.post('/api/media', {
      data: {
        mediaType: 'audio',
        estimateOnly: true,
        urls: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}.mp3`),
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('between 1 and 10');
  });

  test('refuses deletion while a media worker owns the asset', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    const upload = await request.post('/api/media', {
      multipart: {
        file: {
          name: `e2e-active-${Date.now()}.wav`,
          mimeType: 'audio/wav',
          buffer: createSilentWav(),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const activeAssetId = (await upload.json()).assets[0].id as string;

    try {
      const claimed = await request.patch(`/api/media/${activeAssetId}`, {
        data: { processingStatus: 'processing', processingMessage: 'Transcribing...' },
      });
      expect(claimed.ok()).toBe(true);

      const blocked = await request.delete(`/api/media?id=${activeAssetId}`);
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).error).toContain('finish');
    } finally {
      await request.patch(`/api/media/${activeAssetId}`, {
        data: { processingStatus: 'failed', processingMessage: '' },
      });
      await request.delete(`/api/media?id=${activeAssetId}`).catch(() => {});
    }
  });

  test('persists indexing instructions and quality when uploading media', async ({ request }) => {
    test.skip(
      await isDataAddingBlocked(request),
      'Embedding credentials are required before adding data',
    );
    const upload = await request.post('/api/media', {
      multipart: {
        file: {
          name: `e2e-quality-${Date.now()}.wav`,
          mimeType: 'audio/wav',
          buffer: createSilentWav(),
        },
        indexingInstructions: 'Track the score between Team A and Team B',
        indexingQuality: '80',
      },
    });
    expect(upload.status()).toBe(201);
    const body = await upload.json();
    const asset = body.assets[0];
    expect(asset.indexingInstructions).toBe('Track the score between Team A and Team B');
    expect(asset.indexingQuality).toBe(80);

    await request.delete(`/api/media?id=${asset.id}`).catch(() => {});
  });

  test.afterAll(async ({ request }) => {
    if (assetId) await request.delete(`/api/media?id=${assetId}`).catch(() => {});
  });
});
