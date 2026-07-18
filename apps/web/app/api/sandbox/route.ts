import { NextResponse } from "next/server"
import { SandboxManager } from "@larkup/sandbox"
import type { ExecutionRequest } from "@larkup/sandbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const manager = new SandboxManager({ backend: "docker" })

/** GET /api/sandbox — Check sandbox health/status. */
export async function GET() {
  try {
    const health = await manager.healthCheck()
    return NextResponse.json(health)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Health check failed"
    return NextResponse.json(
      { status: "error", error: message },
      { status: 500 },
    )
  }
}

/** POST /api/sandbox — Setup sandbox (build Docker image). */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get("action")

    if (action === "setup") {
      const logs: string[] = []
      await manager.setup((msg) => logs.push(msg))
      return NextResponse.json({ ok: true, logs })
    }

    // Default: execute code
    const body: ExecutionRequest = await req.json()

    if (!body.code) {
      return NextResponse.json(
        { error: "code is required" },
        { status: 400 },
      )
    }

    const result = await manager.execute({
      code: body.code,
      language: body.language ?? "python",
      files: body.files,
      timeout: body.timeout,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
