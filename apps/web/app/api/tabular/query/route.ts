import { NextResponse } from "next/server"
import { queryTabular } from "@larkup/core/tabular-store"
import type { TabularQueryRequest } from "@larkup/core/tabular-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/tabular/query — Execute a structured query against a tabular dataset. */
export async function POST(req: Request) {
  try {
    const body: TabularQueryRequest = await req.json()

    if (!body.datasetId) {
      return NextResponse.json(
        { error: "datasetId is required" },
        { status: 400 },
      )
    }

    const result = await queryTabular(body)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
