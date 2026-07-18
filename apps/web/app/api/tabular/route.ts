import { NextResponse } from "next/server"
import {
  saveTabularDataset,
  listTabularDatasets,
  deleteTabularDataset,
} from "@larkup/core/tabular-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/tabular — List all tabular datasets (metadata only). */
export async function GET() {
  try {
    const datasets = await listTabularDatasets()
    return NextResponse.json({ datasets })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list datasets"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** POST /api/tabular — Save a new tabular dataset. */
export async function POST(req: Request) {
  try {
    const { fileName, rows } = await req.json()

    if (!fileName || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: "fileName and non-empty rows array required" },
        { status: 400 },
      )
    }

    const dataset = await saveTabularDataset(fileName, rows)

    return NextResponse.json({
      id: dataset.id,
      fileName: dataset.fileName,
      rowCount: dataset.rowCount,
      columns: dataset.columns,
      summary: dataset.summary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save dataset"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** DELETE /api/tabular?id=... — Delete a tabular dataset. */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 })
    }
    await deleteTabularDataset(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete dataset"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
