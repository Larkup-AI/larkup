import { promises as fs } from "node:fs"
import path from "node:path"
import { DEFAULT_CONFIG, type RagConfig } from "@/core/types"
import { getDataDir, requireDataDir } from "@/core/workspace"

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
    const parsed = JSON.parse(raw) as Partial<RagConfig>
    // Merge with defaults so newly-added fields are always present.
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      chunking: { ...DEFAULT_CONFIG.chunking, ...parsed.chunking },
      storeConfig: { ...parsed.storeConfig },
    }
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
