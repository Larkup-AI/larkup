import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StorageProvider, StorageStats } from './types';
import { STORAGE_WARNING_THRESHOLDS } from './types';
import { getDataDir, requireDataDir } from '@larkup/core/workspace';

/**
 * Local file-based storage provider for media assets.
 *
 * Stores files under `.larkup/servers/<activeServer>/media/`.
 * Designed to be swappable with cloud providers (S3, UploadThing, GCS)
 * in the future via the StorageProvider interface.
 */

export class LocalStorageProvider implements StorageProvider {
  readonly id = 'local';
  readonly name = 'Local Storage';

  private async mediaDir(): Promise<string> {
    const dataDir = await requireDataDir();
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

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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
        } catch {
          // skip
        }
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
 * Factory: create the appropriate storage provider from config.
 * For now, always returns LocalStorageProvider. Designed for future
 * expansion to S3, UploadThing, GCS, etc.
 */
export function createStorageProvider(_config?: Record<string, any>): StorageProvider {
  // Future: switch on config.provider to create S3Provider, etc.
  return new LocalStorageProvider();
}
