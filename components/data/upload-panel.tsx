"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { FileUp, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const ACCEPT = ".txt,.md,.markdown,.json,.csv,.html,.htm,.log"

interface Staged {
  name: string
  size: number
  content: string
}

export function UploadPanel({ onAdded }: { onAdded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [staged, setStaged] = useState<Staged[]>([])
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)

  async function readFiles(files: FileList | File[]) {
    const next: Staged[] = []
    for (const file of Array.from(files)) {
      try {
        const content = await file.text()
        next.push({ name: file.name, size: file.size, content })
      } catch {
        toast.error(`Could not read ${file.name} — text files only.`)
      }
    }
    setStaged((prev) => [...prev, ...next])
  }

  async function ingest() {
    if (staged.length === 0) return
    setSaving(true)
    let ok = 0
    for (const f of staged) {
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: f.name, content: f.content, source: "upload" }),
        })
        if (res.ok) ok++
      } catch {
        /* continue */
      }
    }
    setSaving(false)
    setStaged([])
    if (ok > 0) {
      toast.success(`Added ${ok} file${ok > 1 ? "s" : ""} to corpus`)
      onAdded()
    } else {
      toast.error("No files could be added.")
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:bg-muted/70",
          dragging && "border-primary bg-accent",
        )}
      >
        <FileUp className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">
          Drop files here or click to browse
        </span>
        <span className="text-xs text-muted-foreground">
          Text-based files: .txt, .md, .json, .csv, .html, .log
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) readFiles(e.target.files)
          e.target.value = ""
        }}
      />

      {staged.length > 0 && (
        <ul className="space-y-1.5">
          {staged.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {f.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {(f.size / 1024).toFixed(1)} KB
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setStaged((p) => p.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button onClick={ingest} disabled={saving || staged.length === 0}>
        {saving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        Add {staged.length > 0 ? staged.length : ""} file
        {staged.length === 1 ? "" : "s"} to corpus
      </Button>
    </div>
  )
}
