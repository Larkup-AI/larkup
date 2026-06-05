"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  FileText,
  Trash2,
  ClipboardPaste,
  FileUp,
  Globe,
  Pencil,
  Loader2,
  X,
} from "lucide-react"
import type { DocumentSource, SourceDocument } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const SOURCE_META: Record<
  DocumentSource,
  { label: string; icon: typeof Globe }
> = {
  scrape: { label: "Scraped", icon: Globe },
  paste: { label: "Pasted", icon: ClipboardPaste },
  upload: { label: "Uploaded", icon: FileUp },
}

export function CorpusPanel({
  documents,
  onChanged,
}: {
  documents: SourceDocument[]
  onChanged: () => void
}) {
  const [active, setActive] = useState<SourceDocument | null>(null)

  async function del(id: string) {
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" })
    toast.message("Document deleted")
    onChanged()
  }
  async function clearAll() {
    await fetch("/api/documents", { method: "DELETE" })
    toast.message("Corpus cleared")
    onChanged()
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
        <FileText className="size-7 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">Your corpus is empty</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Scrape the web, paste text, or upload files. Everything you collect is
          stored locally and ready to index in the next step.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between pb-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {documents.length}
          </span>{" "}
          document{documents.length === 1 ? "" : "s"} in corpus
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground hover:text-destructive"
          onClick={clearAll}
        >
          <Trash2 className="size-3.5" />
          Clear corpus
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Source</TableHead>
              <TableHead className="w-24 text-right">Chars</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => {
              const meta = SOURCE_META[doc.source]
              const Icon = meta.icon
              return (
                <TableRow key={doc.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setActive(doc)}
                      className="group flex flex-col items-start text-left"
                    >
                      <span className="line-clamp-1 text-sm font-medium group-hover:text-primary">
                        {doc.title}
                      </span>
                      {doc.url && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {doc.url}
                        </span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1 font-normal">
                      <Icon className="size-3" />
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {doc.charCount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label="Edit document"
                        onClick={() => setActive(doc)}
                        className="text-muted-foreground transition-colors hover:text-primary"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete document"
                        onClick={() => del(doc.id)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <DocumentDialog
        doc={active}
        onOpenChange={(o) => !o && setActive(null)}
        onSaved={() => {
          setActive(null)
          onChanged()
        }}
        onDelete={async (id) => {
          await del(id)
          setActive(null)
        }}
      />
    </>
  )
}

function DocumentDialog({
  doc,
  onOpenChange,
  onSaved,
  onDelete,
}: {
  doc: SourceDocument | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)

  // Reset local state whenever a different document is opened.
  useEffect(() => {
    if (doc) {
      setEditing(false)
      setTitle(doc.title)
      setUrl(doc.url ?? "")
      setContent(doc.content)
    }
  }, [doc])

  async function save() {
    if (!doc) return
    if (!content.trim()) {
      toast.error("Content can't be empty.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: doc.id,
          title: title.trim() || "Untitled",
          url: url.trim(),
          content,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Failed to save document.")
        return
      }
      toast.success("Document saved")
      onSaved()
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-balance">
            {editing ? "Edit document" : doc?.title}
          </DialogTitle>
          {!editing && doc?.url && (
            <DialogDescription className="break-all">
              {doc.url}
            </DialogDescription>
          )}
          {editing && (
            <DialogDescription>
              Changes are saved to this server&apos;s corpus. Re-index to apply
              them to search.
            </DialogDescription>
          )}
        </DialogHeader>

        {editing ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="doc-url">URL (optional)</Label>
              <Input
                id="doc-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="doc-content">Content</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {content.length.toLocaleString()} chars
                </span>
              </div>
              <Textarea
                id="doc-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                className="resize-none font-mono text-xs leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] rounded-md border border-border bg-muted/30">
            <pre
              className={cn(
                "whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-foreground",
              )}
            >
              {doc?.content}
            </pre>
          </ScrollArea>
        )}

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          {editing ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                <X className="size-4" />
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => doc && onDelete(doc.id)}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
