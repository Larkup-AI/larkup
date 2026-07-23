import { expect, test } from '@playwright/test';

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

  test('uploads audio, lists metadata, and serves byte ranges', async ({ request }) => {
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

  test.afterAll(async ({ request }) => {
    if (assetId) await request.delete(`/api/media?id=${assetId}`).catch(() => {});
  });
});
