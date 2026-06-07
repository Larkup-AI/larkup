import { promises as fs } from "node:fs"
import path from "node:path"
import { spawn, exec } from "node:child_process"
import { promisify } from "node:util"
import type { RagConfig } from "../types"
import { generateServer } from "./generate-server"
import {
  getActiveServer,
  getDataDir,
  requireDataDir,
} from "../workspace"

/**
 * Launches a server's GENERATED RAG server locally as a detached Node process.
 *
 * Flow: emit the files to the server's `generated-server/` dir, `npm install`
 * the (minimal) deps, then `node server.mjs` on that server's assigned port.
 * We persist the pid + port so the UI can show status and stop it. Each
 * workspace server has its own port, so many can run at once.
 *
 * Only meaningful for stores that can run from the toolkit host (LanceDB
 * local). Cloud stores (Pinecone, LanceDB Cloud) are deploy-only.
 */

const execAsync = promisify(exec)
const FALLBACK_PORT = 8080

/** Kill any process listening on the given TCP port (best-effort). */
async function killPort(port: number): Promise<void> {
  try {
    // macOS / Linux: find pids using lsof and SIGKILL them
    const { stdout } = await execAsync(`lsof -ti tcp:${port}`)
    const pids = stdout.split("\n").map((s) => s.trim()).filter(Boolean)
    for (const pid of pids) {
      try { process.kill(Number(pid), 9) } catch { /* already gone */ }
    }
    // Give OS a moment to release the port
    await new Promise((r) => setTimeout(r, 300))
  } catch {
    // lsof returned nothing (port was free) — that's fine
  }
}

export interface LocalServerState {
  running: boolean
  pid?: number
  port: number
  endpoint: string
  generatedAt?: string
  startedAt?: string
  lastError?: string
}

async function resolvePort(): Promise<number> {
  const server = await getActiveServer()
  return server?.port ?? FALLBACK_PORT
}

function emptyState(port: number): LocalServerState {
  return {
    running: false,
    port,
    endpoint: `http://localhost:${port}`,
  }
}

async function outDir(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir()
  if (!dir) return null
  return path.join(dir, "generated-server")
}

async function statePath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir()
  if (!dir) return null
  return path.join(dir, "server-local.json")
}

export async function readServerState(): Promise<LocalServerState> {
  const port = await resolvePort()
  const file = await statePath(false)
  if (!file) return emptyState(port)
  try {
    const raw = await fs.readFile(file, "utf8")
    return { ...emptyState(port), ...(JSON.parse(raw) as Partial<LocalServerState>), port }
  } catch {
    return emptyState(port)
  }
}

async function writeState(state: LocalServerState) {
  const file = await statePath(true)
  if (file) await fs.writeFile(file, JSON.stringify(state, null, 2), "utf8")
  return state
}

/** Is a pid still alive? */
function pidAlive(pid?: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Write the generated server files to disk (always refreshes the output). */
export async function emitToDisk(config: RagConfig): Promise<string> {
  const server = generateServer(config)
  const dir = await outDir(true)
  if (!dir) throw new Error("No active server to emit to.")
  await fs.mkdir(dir, { recursive: true })
  for (const file of server.files) {
    const dest = path.join(dir, file.path)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    if (file.encoding === "base64") {
      await fs.writeFile(dest, Buffer.from(file.contents, "base64"))
    } else {
      await fs.writeFile(dest, file.contents, "utf8")
    }
  }
  return dir
}

async function isHealthy(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Launch the generated server locally.
 */
export async function startServer(config: RagConfig, serverApiKey?: string): Promise<LocalServerState> {
  const port = await resolvePort()
  const endpoint = `http://localhost:${port}`

  // Always stop any existing server first so the new key is picked up.
  const prev = await readServerState()
  if (prev.pid && pidAlive(prev.pid)) {
    try { process.kill(prev.pid, 9) } catch { /* already gone */ }
  }
  // Also kill anything squatting on the port (e.g. orphaned detached processes).
  await killPort(port)

  // Emit fresh generated files (always refreshes server.mjs with latest config).
  const dir = await emitToDisk(config)

  // Install minimal deps (idempotent).
  try {
    await execAsync("npm install --omit=dev", { cwd: dir, timeout: 240_000 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "npm install failed"
    return writeState({ ...emptyState(port), lastError: message })
  }

  // Point the generated LanceDB server at this server's existing table.
  const dbPath = config.storeConfig.dbPath || "./.ragtoolkit/lancedb"
  const absDb = path.isAbsolute(dbPath)
    ? dbPath
    : path.join(process.cwd(), dbPath)

  // Truncate log so auth debug lines are easy to spot.
  const logPath = path.join(dir, "server.log")
  await fs.writeFile(logPath, "", "utf8")
  const logFd = await fs.open(logPath, "a")
  const script = ["server", "mjs"].join(".")
  const child = spawn("node", [script], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", logFd.fd, logFd.fd],
    env: {
      ...process.env,
      PORT: String(port),
      TOP_K: String(config.topK),
      SERVER_API_KEY: serverApiKey || "",
      PINECONE_API_KEY: config.storeConfig.apiKey || "",
      PINECONE_INDEX: config.storeConfig.indexName || "",
      PINECONE_NAMESPACE: config.storeConfig.namespace || "",
      PINECONE_SPARSE_MODEL: config.storeConfig.sparseModel || "",
      PINECONE_SPARSE_INDEX: config.storeConfig.sparseIndexName || "",
      LANCEDB_MODE: config.storeConfig.mode || "local",
      LANCEDB_PATH: absDb,
      LANCEDB_URI: config.storeConfig.uri || "",
      LANCEDB_API_KEY: config.storeConfig.apiKey || "",
      LANCEDB_TABLE: config.storeConfig.tableName || "documents",
    },
  })
  child.unref()
  await logFd.close()

  const healthy = await waitForHealth(endpoint, 20_000)

  return writeState({
    running: healthy,
    pid: child.pid,
    port,
    endpoint,
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    lastError: healthy
      ? undefined
      : "Server process started but did not become healthy in time. Check the server's generated-server/server.log.",
  })
}

export async function stopServer(): Promise<LocalServerState> {
  const state = await readServerState()
  const port = state.port || FALLBACK_PORT
  // Kill the tracked pid
  if (state.pid && pidAlive(state.pid)) {
    try { process.kill(state.pid, 9) } catch { /* already gone */ }
  }
  // Kill anything still on the port (detached orphans)
  await killPort(port)
  return writeState({
    ...state,
    running: false,
    pid: undefined,
    startedAt: undefined,
  })
}

export async function refreshServerStatus(): Promise<LocalServerState> {
  const state = await readServerState()
  if (!state.startedAt) return state
  const alive = pidAlive(state.pid) && (await isHealthy(state.endpoint))
  if (alive !== state.running) {
    return writeState({ ...state, running: alive })
  }
  return state
}

async function waitForHealth(endpoint: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isHealthy(endpoint)) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}
