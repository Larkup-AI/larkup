import { NextResponse } from "next/server"
import {
  addDocument,
  clearDocuments,
  corpusStats,
  deleteDocument,
  deleteDocuments,
  readDocuments,
  updateDocument,
} from "@buddy-rag/core/documents-store"
import type { DocumentSource } from "@buddy-rag/core/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET → the full corpus plus summary stats. */
export async function GET() {
  const [documents, stats] = await Promise.all([readDocuments(), corpusStats()])
  return NextResponse.json({ documents, stats })
}

/**
 * POST → ingest pasted text or an uploaded file's contents.
 * Body: { title, content, source: "paste" | "upload", url? }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      title?: string
      content?: string
      source?: DocumentSource
      url?: string
      metadata?: Record<string, any>
    }
    if (!body.content || !body.content.trim()) {
      return NextResponse.json({ error: "Content is empty." }, { status: 400 })
    }
    const doc = await addDocument({
      title: body.title ?? "Untitled",
      content: body.content,
      source: body.source === "upload" ? "upload" : "paste",
      url: body.url,
      metadata: body.metadata,
    })
    return NextResponse.json({ document: doc }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add document."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PATCH → edit a document in place.
 * Body: { id, title?, content?, url? }
 */
export async function PATCH(req: Request) {
  let body: { id?: string; title?: string; content?: string; url?: string; metadata?: Record<string, any> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 })
  }
  if (body.content !== undefined && !body.content.trim()) {
    return NextResponse.json({ error: "Content is empty." }, { status: 400 })
  }
  const doc = await updateDocument(body.id, {
    title: body.title,
    content: body.content,
    url: body.url,
    metadata: body.metadata,
  })
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 })
  }
  return NextResponse.json({ document: doc })
}

/** DELETE ?id=<id> removes one doc; DELETE ?ids=1,2 removes many; DELETE with no id clears the corpus. */
export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  const ids = url.searchParams.get("ids")
  if (id) await deleteDocument(id)
  else if (ids) await deleteDocuments(ids.split(","))
  else await clearDocuments()
  return NextResponse.json({ ok: true })
}
