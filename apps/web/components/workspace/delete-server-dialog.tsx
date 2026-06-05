"use client"

import { useState } from "react"
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
import { useWorkspace, type WorkspaceServer } from "./workspace-provider"

interface Props {
  target: WorkspaceServer | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteServerDialog({ target, open, onOpenChange }: Props) {
  const { deleteServer } = useWorkspace()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!target) return
    setBusy(true)
    try {
      await deleteServer(target.id)
      toast.success(`Deleted "${target.name}".`)
      onOpenChange(false)
    } catch {
      toast.error("Could not delete the server.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{target?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            This permanently removes the server&apos;s documents, index, vector
            data, and generated files. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Delete server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
