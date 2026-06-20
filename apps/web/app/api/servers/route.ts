import { NextResponse } from "next/server"
import {
  createServer,
  deleteServer,
  getWorkspace,
  renameServer,
  runWithServer,
  setActiveServer,
  setUsername,
  type ServerMeta,
} from "@larkup-rag/core/workspace"
import { corpusStats } from "@larkup-rag/core/documents-store"
import { readRun } from "@larkup-rag/core/index-store"
import { readServerState } from "@larkup-rag/core/generator/server-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** A server entry enriched with lightweight, per-server status for the UI. */
async function decorate(server: ServerMeta) {
  return runWithServer(server.id, async () => {
    const [stats, run, state] = await Promise.all([
      corpusStats(),
      readRun(),
      readServerState(),
    ])
    return {
      ...server,
      docCount: stats.docCount,
      indexed: run?.status === "completed" && (run.totalChunks ?? 0) > 0,
      running: state.running,
      endpoint: state.endpoint,
    }
  })
}

/** GET → the full workspace: username, active server, and decorated servers. */
export async function GET() {
  const ws = await getWorkspace()
  const servers = await Promise.all(ws.servers.map(decorate))
  return NextResponse.json({
    username: ws.username,
    activeServerId: ws.activeServerId,
    servers,
  })
}

/** POST { name } → create a new server (and make it active). */
export async function POST(req: Request) {
  let body: { name?: string } = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — server gets a default name
  }
  const { server } = await createServer(body.name ?? "Untitled server")
  return NextResponse.json({ server }, { status: 201 })
}

/**
 * PATCH → workspace mutations.
 * Body: { action: "activate" | "rename" | "setUsername", serverId?, name?, username? }
 */
export async function PATCH(req: Request) {
  let body: {
    action?: string
    serverId?: string
    name?: string
    username?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  switch (body.action) {
    case "activate": {
      if (!body.serverId) {
        return NextResponse.json(
          { error: "serverId is required." },
          { status: 400 },
        )
      }
      return NextResponse.json({ workspace: await setActiveServer(body.serverId) })
    }
    case "rename": {
      if (!body.serverId || !body.name?.trim()) {
        return NextResponse.json(
          { error: "serverId and name are required." },
          { status: 400 },
        )
      }
      return NextResponse.json({
        workspace: await renameServer(body.serverId, body.name),
      })
    }
    case "setUsername": {
      return NextResponse.json({
        workspace: await setUsername(body.username ?? ""),
      })
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 })
  }
}

/** DELETE ?id=<id> — stop the server's instance, then remove all its data. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 })
  }
  // Stop any running instance in the target server's context first.
  try {
    const { stopServer } = await import("@larkup-rag/core/generator/server-runtime")
    await runWithServer(id, () => stopServer())
  } catch {
    // best effort — still remove the data
  }
  return NextResponse.json({ workspace: await deleteServer(id) })
}
