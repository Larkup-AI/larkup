import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const getSignedUrlMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = sendMock;
  }
  class PutObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

import { S3StorageProvider } from './storage-provider';

describe('S3StorageProvider', () => {
  beforeEach(() => {
    sendMock.mockReset();
    getSignedUrlMock.mockReset();
  });

  it('stores an object under the canonical prefix, KMS-encrypted, and returns an s3:// uri', async () => {
    sendMock.mockResolvedValueOnce({});
    const provider = new S3StorageProvider({ bucket: 'my-bucket', kmsKeyId: 'arn:aws:kms:1' });
    const uri = await provider.store('videos/a.mp4', Buffer.from('data'), 'video/mp4');
    expect(uri).toBe('s3://my-bucket/canonical/videos/a.mp4');
    const sentCommand = sendMock.mock.calls[0][0];
    expect(sentCommand.input).toMatchObject({
      Bucket: 'my-bucket',
      Key: 'canonical/videos/a.mp4',
      ContentType: 'video/mp4',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'arn:aws:kms:1',
    });
  });

  it('uses a custom prefix when configured', async () => {
    sendMock.mockResolvedValueOnce({});
    const provider = new S3StorageProvider({ bucket: 'b', prefix: 'tmp' });
    const uri = await provider.store('x.mp4', Buffer.from('d'), 'video/mp4');
    expect(uri).toBe('s3://b/tmp/x.mp4');
  });

  it('retrieve() streams and concatenates the object body', async () => {
    const chunks = [Buffer.from('hel'), Buffer.from('lo')];
    sendMock.mockResolvedValueOnce({
      Body: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    });
    const provider = new S3StorageProvider({ bucket: 'my-bucket' });
    const data = await provider.retrieve('s3://my-bucket/canonical/videos/a.mp4');
    expect(data.toString('utf-8')).toBe('hello');
    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      Bucket: 'my-bucket',
      Key: 'canonical/videos/a.mp4',
    });
  });

  it('retrieve() rejects a non-s3 uri', async () => {
    const provider = new S3StorageProvider({ bucket: 'b' });
    await expect(provider.retrieve('local://x.mp4')).rejects.toThrow(/Unsupported S3 storage URI/);
  });

  it('resolvePath always returns undefined, forcing callers to a remote path', async () => {
    const provider = new S3StorageProvider({ bucket: 'b' });
    await expect(provider.resolvePath('s3://b/canonical/x.mp4')).resolves.toBeUndefined();
  });

  it('getReadUrl produces a presigned GET url scoped to the parsed bucket/key', async () => {
    getSignedUrlMock.mockResolvedValueOnce('https://signed.example/x.mp4?sig=1');
    const provider = new S3StorageProvider({ bucket: 'my-bucket' });
    const url = await provider.getReadUrl('s3://my-bucket/canonical/videos/a.mp4', 3600);
    expect(url).toBe('https://signed.example/x.mp4?sig=1');
    const [, command, options] = getSignedUrlMock.mock.calls[0];
    expect(command.input).toMatchObject({ Bucket: 'my-bucket', Key: 'canonical/videos/a.mp4' });
    expect(options).toEqual({ expiresIn: 3600 });
  });

  it('delete() swallows a failure instead of throwing (object may already be gone)', async () => {
    sendMock.mockRejectedValueOnce(new Error('NoSuchKey'));
    const provider = new S3StorageProvider({ bucket: 'b' });
    await expect(provider.delete('s3://b/canonical/gone.mp4')).resolves.toBeUndefined();
  });

  it('constructor requires a bucket name', () => {
    expect(() => new S3StorageProvider({ bucket: '' })).toThrow(/requires a bucket name/);
  });
});
