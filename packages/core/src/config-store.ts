import { promises as fs } from "node:fs"
import path from "node:path"
import { DEFAULT_CONFIG, type RagConfig } from "./types"
import { getDataDir, requireDataDir } from "./workspace"

/**
 * File-backed persistence for a server's RAG configuration.
 *
 * Each server (workspace project) keeps its own `config.json` under its data
 * dir; this store resolves "which server" from the active workspace context.
 * The same file is read by the CLI and used to generate the deployable server.
 */

export async function readConfig(): Promise<RagConfig> {
  const dir = await getDataDir()
  if (!dir) return DEFAULT_CONFIG
  try {
    const raw = await fs.readFile(path.join(dir, "config.json"), "utf8")
    // Use `any` for the parsed object so we can read legacy fields before migration.
    const parsed = JSON.parse(raw) as Partial<RagConfig> & { customEmbedding?: unknown }

    // ── Backward-compatibility migration ──────────────────────────────────────
    // Older versions stored a single `customEmbedding` object. Migrate it to
    // the new `customEmbeddings` array on the fly so existing configs keep
    // working without a manual re-save.
    let migratedEmbeddings = parsed.customEmbeddings
    let migratedEmbeddingId = parsed.embeddingModelId

    if (parsed.customEmbedding && !migratedEmbeddings?.length) {
      const legacy = parsed.customEmbedding as import("./types").CustomModelConfig
      migratedEmbeddings = [legacy]
      // If the saved id was the old flat "custom", point to the named variant.
      if (migratedEmbeddingId === "custom") {
        migratedEmbeddingId = `custom:${legacy.modelName}`
      }
    }

    // Merge with defaults so newly-added fields are always present.
    const result: RagConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      embeddingModelId: migratedEmbeddingId ?? DEFAULT_CONFIG.embeddingModelId,
      customEmbeddings: migratedEmbeddings,
      chunking: { ...DEFAULT_CONFIG.chunking, ...parsed.chunking },
      storeConfig: { ...DEFAULT_CONFIG.storeConfig, ...parsed.storeConfig },
    }

    // Drop the stale legacy key so it doesn't leak into the returned object.
    delete (result as unknown as Record<string, unknown>)["customEmbedding"]

    return result
  } catch {
    // No config yet — return defaults (not persisted until first save).
    return DEFAULT_CONFIG
  }
}

export async function writeConfig(config: RagConfig): Promise<RagConfig> {
  const dir = await requireDataDir()
  const next: RagConfig = { ...config, updatedAt: new Date().toISOString() }
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify(next, null, 2),
    "utf8",
  )
  return next
}
