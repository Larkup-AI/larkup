import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StorageProvider, StorageStats } from './types';
import { STORAGE_WARNING_THRESHOLDS } from './types';
import { requireProjectDataDir } from '@larkup/core/project-store';

/**
 * Local file-based storage provider for media assets.
 *
 * Stores files under `.larkup/projects/<activeProject>/media/`.
 * Designed to be swappable with cloud providers (S3, UploadThing, GCS)
 * in the future via the StorageProvider interface.
 */

export class LocalStorageProvider implements StorageProvider {
  readonly id = 'local';
  readonly name = 'Local Storage';

  private async mediaDir(): Promise<string> {
    const dataDir = await requireProjectDataDir();
    const dir = path.join(dataDir, 'media');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async store(key: string, data: Buffer, _mimeType: string): Promise<string> {
    const dir = await this.mediaDir();
    const filePath = path.join(dir, key);
    // Ensure subdirectories exist (e.g., "thumbnails/abc.webp")
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return `local://${key}`;
  }

  async storeFile(key: string, sourcePath: string, _mimeType: string): Promise<string> {
    const dir = await this.mediaDir();
    const filePath = path.join(dir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.copyFile(sourcePath, filePath);
    return `local://${key}`;
  }

  async retrieve(uri: string): Promise<Buffer> {
    const filePath = await this.resolvePath(uri);
    if (!filePath) throw new Error(`Unsupported local storage URI: ${uri}`);
    return fs.readFile(filePath);
  }

  async resolvePath(uri: string): Promise<string | undefined> {
    if (!uri.startsWith('local://')) return undefined;
    const key = uri.slice('local://'.length);
    const dir = await this.mediaDir();
    const filePath = path.resolve(dir, key);
    const relative = path.relative(dir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Invalid local storage URI');
    }
    return filePath;
  }

  async delete(uri: string): Promise<void> {
    const key = uri.replace('local://', '');
    const dir = await this.mediaDir();
    try {
      await fs.unlink(path.join(dir, key));
    } catch {
      // File may already be deleted
    }
  }

  async stats(): Promise<StorageStats> {
    try {
      const dir = await this.mediaDir();
      return await computeDirStats(dir);
    } catch {
      return { usedBytes: 0, fileCount: 0 };
    }
  }
}

async function computeDirStats(dir: string): Promise<StorageStats> {
  let usedBytes = 0;
  let fileCount = 0;

  async function walk(d: string) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        try {
          const stat = await fs.stat(full);
          usedBytes += stat.size;
          fileCount++;
        } catch {}
      }
    }
  }

  await walk(dir);
  return { usedBytes, fileCount };
}

/**
 * Format bytes for human display.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Check if storage usage exceeds any warning threshold.
 * Returns the highest exceeded threshold or null.
 */
export function getStorageWarningLevel(usedBytes: number): number | null {
  for (let i = STORAGE_WARNING_THRESHOLDS.length - 1; i >= 0; i--) {
    if (usedBytes >= STORAGE_WARNING_THRESHOLDS[i]) {
      return STORAGE_WARNING_THRESHOLDS[i];
    }
  }
  return null;
}

/**
 * S3-backed storage provider for durable canonical media (video sources that
 * watch_original must be able to re-inspect at any point, not just at
 * indexing time).
 *
 * Every object is written under a `canonical/` key prefix and encrypted with
 * the configured KMS key. `canonical/` is deliberately kept out of the
 * short-lived processing bucket's `sources/`/`results/` lifecycle rules (see
 * deploy/aws/template.yaml) so a canonical source's retention is governed
 * only by retainSourceHours-driven explicit deletion, never a bucket-wide
 * expiration policy.
 */
export class S3StorageProvider implements StorageProvider {
  readonly id = 's3';
  readonly name = 'Amazon S3';

  private readonly bucket: string;
  private readonly region: string;
  private readonly kmsKeyId?: string;
  private readonly prefix: string;
  private _client: any;
  private _credentials: { accessKeyId: string; secretAccessKey: string } | undefined;

  constructor(config: {
    bucket: string;
    region?: string;
    kmsKeyId?: string;
    prefix?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) {
    if (!config.bucket) throw new Error('S3StorageProvider requires a bucket name.');
    this.bucket = config.bucket;
    this.region = config.region || process.env.AWS_REGION || 'us-east-1';
    this.kmsKeyId = config.kmsKeyId;
    this.prefix = (config.prefix ?? 'canonical').replace(/^\/+|\/+$/g, '');
    this._credentials =
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined;
  }

  private async client(): Promise<any> {
    if (!this._client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this._client = new S3Client({
        region: this.region,
        ...(this._credentials ? { credentials: this._credentials } : {}),
      });
    }
    return this._client;
  }

  private objectKey(key: string): string {
    return `${this.prefix}/${key}`;
  }

  private parseUri(uri: string): { bucket: string; key: string } {
    if (!uri.startsWith('s3://')) throw new Error(`Unsupported S3 storage URI: ${uri}`);
    const withoutScheme = uri.slice('s3://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex < 0) throw new Error(`Malformed S3 storage URI: ${uri}`);
    return { bucket: withoutScheme.slice(0, slashIndex), key: withoutScheme.slice(slashIndex + 1) };
  }

  async store(key: string, data: Buffer, mimeType: string): Promise<string> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const objectKey = this.objectKey(key);
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: data,
        ContentType: mimeType,
        ...(this.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId }
          : { ServerSideEncryption: 'aws:kms' }),
      }),
    );
    return `s3://${this.bucket}/${objectKey}`;
  }

  async storeFile(key: string, sourcePath: string, mimeType: string): Promise<string> {
    return this.store(key, await fs.readFile(sourcePath), mimeType);
  }

  async retrieve(uri: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { bucket, key } = this.parseUri(uri);
    const client = await this.client();
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // Never local: every call site that checks resolvePath?.() already falls
  // back to retrieve()/getReadUrl() for a non-local provider.
  async resolvePath(_uri: string): Promise<string | undefined> {
    return undefined;
  }

  async getReadUrl(uri: string, expiresInSecs: number): Promise<string | undefined> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { bucket, key } = this.parseUri(uri);
    const client = await this.client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSecs,
    });
  }

  async delete(uri: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const { bucket, key } = this.parseUri(uri);
    const client = await this.client();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      // Object may already be deleted.
    }
  }

  async stats(): Promise<StorageStats> {
    // S3 has no cheap aggregate byte count without a full ListObjects scan
    // or S3 Storage Lens; the storage-usage UI is a local-disk concept only.
    return { usedBytes: 0, fileCount: 0 };
  }
}

/**
 * Factory: create the appropriate storage provider from config.
 *
 * Env-driven so it can change without a code change: set
 * LARKUP_MEDIA_STORAGE=s3 with LARKUP_MEDIA_S3_BUCKET (and optionally
 * LARKUP_MEDIA_S3_REGION / LARKUP_MEDIA_S3_KMS_KEY_ID / a scoped
 * LARKUP_MEDIA_S3_ACCESS_KEY_ID+SECRET) to store canonical media in S3
 * instead of local disk. Falls back to LocalStorageProvider otherwise.
 */
export function createStorageProvider(_config?: Record<string, any>): StorageProvider {
  const provider = (_config?.provider ?? process.env.LARKUP_MEDIA_STORAGE ?? 'local').toLowerCase();
  if (provider === 's3') {
    const bucket = _config?.bucket ?? process.env.LARKUP_MEDIA_S3_BUCKET;
    if (!bucket) {
      throw new Error('LARKUP_MEDIA_STORAGE=s3 requires LARKUP_MEDIA_S3_BUCKET to be set.');
    }
    return new S3StorageProvider({
      bucket,
      region: _config?.region ?? process.env.LARKUP_MEDIA_S3_REGION,
      kmsKeyId: _config?.kmsKeyId ?? process.env.LARKUP_MEDIA_S3_KMS_KEY_ID,
      prefix: _config?.prefix ?? process.env.LARKUP_MEDIA_S3_PREFIX,
      accessKeyId:
        _config?.accessKeyId ??
        process.env.LARKUP_MEDIA_S3_ACCESS_KEY_ID ??
        process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey:
        _config?.secretAccessKey ??
        process.env.LARKUP_MEDIA_S3_SECRET_ACCESS_KEY ??
        process.env.AWS_SECRET_ACCESS_KEY,
    });
  }
  return new LocalStorageProvider();
}
