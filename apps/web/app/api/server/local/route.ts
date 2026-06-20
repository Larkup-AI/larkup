import { NextResponse } from "next/server"
import { readConfig } from "@larkup-rag/core/config-store"
import {
  readServerState,
  refreshServerStatus,
  startServer,
  stopServer,
} from "@larkup-rag/core/generator/server-runtime"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** GET — current local server status (re-checked against the live process). */
export async function GET() {
  const state = await refreshServerStatus()
  return NextResponse.json({ state })
}

/** POST { action: "start" | "stop" } — control the local generated server. */
export async function POST(req: Request) {
  let action = "start"
  let serverApiKey = ""
  try {
    const body = await req.json()
    if (body?.action) action = String(body.action)
    if (body?.serverApiKey) serverApiKey = String(body.serverApiKey)
  } catch {
    // default to start
  }

  if (action === "stop") {
    return NextResponse.json({ state: await stopServer() })
  }

  if (action === "status") {
    return NextResponse.json({ state: await readServerState() })
  }

  const config = await readConfig()
  const state = await startServer(config, serverApiKey)
  return NextResponse.json({ state })
}
