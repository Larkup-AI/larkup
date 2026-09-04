import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, type RagConfig } from './types';
import { requireProjectDataDir } from './project-store';

/**
 * File-backed persistence for a Project's RAG configuration.
 *
 * Each Project keeps its own `config.json` under its data directory; this
 * store resolves the active Project through the Project scope.
 * The same file is read by the CLI and used to generate the deployable server.
 */

export async function readConfig(): Promise<RagConfig> {
  const dir = await requireProjectDataDir();
  try {
    const raw = await fs.readFile(path.join(dir, 'config.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RagConfig> & { customEmbedding?: unknown };

    // Backward-compatible migration.
    // working without a manual re-save.
    let migratedEmbeddings = parsed.customEmbeddings;
    let migratedEmbeddingId = parsed.embeddingModelId;

    if (parsed.customEmbedding && !migratedEmbeddings?.length) {
      const legacy = parsed.customEmbedding as import('./types').CustomModelConfig;
      migratedEmbeddings = [legacy];
      if (migratedEmbeddingId === 'custom') {
        migratedEmbeddingId = `custom:${legacy.modelName}`;
      }
    }

    const storedDbPath = parsed.storeConfig?.dbPath;
    const usesLegacyRelativeProjectPath =
      typeof storedDbPath === 'string' &&
      /^(?:\.\/)?\.larkup\/projects\/[^/]+\/index\/?$/.test(storedDbPath);
    const result: RagConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      embeddingModelId: migratedEmbeddingId ?? DEFAULT_CONFIG.embeddingModelId,
      customEmbeddings: migratedEmbeddings,
      chunking: { ...DEFAULT_CONFIG.chunking, ...parsed.chunking },
      storeConfig: {
        ...DEFAULT_CONFIG.storeConfig,
        ...parsed.storeConfig,
        // A copied packaged workspace used to point its vector index back into
        // node_modules via a relative path. Keep the index alongside the
        // migrated project whenever a durable data root is configured.
        ...(process.env.LARKUP_DATA_DIR?.trim() && usesLegacyRelativeProjectPath
          ? { dbPath: path.join(dir, 'index') }
          : {}),
      },
    };

    delete (result as unknown as Record<string, unknown>)['customEmbedding'];

    return result;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeConfig(config: RagConfig): Promise<RagConfig> {
  const dir = await requireProjectDataDir();
  const next: RagConfig = { ...config, updatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
