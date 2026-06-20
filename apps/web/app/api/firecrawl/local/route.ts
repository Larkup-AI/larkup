import { NextResponse } from "next/server"
import {
  checkDocker,
  readLocalState,
  refreshLocalStatus,
  startLocal,
  stopLocal,
} from "@larkup-rag/scraper/local-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET → current local instance state + docker availability. */
export async function GET() {
  const [state, docker] = await Promise.all([
    refreshLocalStatus(),
    checkDocker(),
  ])
  // Never leak the bearer token to the client; just report whether one exists.
  const { apiKey, ...safe } = state
  return NextResponse.json({
    state: { ...safe, hasKey: Boolean(apiKey) },
    docker,
  })
}

/** POST { action: "start" | "stop" } → control the local Firecrawl container. */
export async function POST(req: Request) {
  let action: string | undefined
  try {
    ;({ action } = (await req.json()) as { action?: string })
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  if (action !== "start" && action !== "stop") {
    return NextResponse.json(
      { error: 'action must be "start" or "stop".' },
      { status: 400 },
    )
  }

  const state = action === "start" ? await startLocal() : await stopLocal()
  const { apiKey, ...safe } = state
  return NextResponse.json({ state: { ...safe, hasKey: Boolean(apiKey) } })
}
