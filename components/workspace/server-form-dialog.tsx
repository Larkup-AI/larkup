"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkspace, type WorkspaceServer } from "./workspace-provider"

interface Props {
  mode: "create" | "rename"
  target?: WorkspaceServer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ServerFormDialog({ mode, target, open, onOpenChange }: Props) {
  const { createServer, renameServer } = useWorkspace()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  // Seed the field whenever the dialog opens.
  useEffect(() => {
    if (open) setName(mode === "rename" ? (target?.name ?? "") : "")
  }, [open, mode, target])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Enter a server name.")
      return
    }
    setBusy(true)
    try {
      if (mode === "create") {
        const created = await createServer(trimmed)
        if (created) toast.success(`Created "${created.name}" and switched to it.`)
      } else if (target) {
        await renameServer(target.id, trimmed)
        toast.success("Server renamed.")
      }
      onOpenChange(false)
    } catch {
      toast.error("Something went wrong. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New RAG server" : "Rename server"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Each server is an isolated RAG project with its own documents, index, and deployable artifact."
              : "Give this server a clearer name."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="server-name">Server name</Label>
          <Input
            id="server-name"
            value={name}
            autoFocus
            placeholder="e.g. docs-assistant"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit()
            }}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "create" ? "Create server" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
