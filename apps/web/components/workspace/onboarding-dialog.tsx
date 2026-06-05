"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Boxes, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkspace } from "./workspace-provider"

/**
 * First-run experience. Shown automatically when the workspace has no servers.
 * Collects a display name and spins up the user's first RAG server.
 */
export function OnboardingDialog() {
  const { isFirstRun, setUsername, createServer } = useWorkspace()
  const [username, setName] = useState("")
  const [serverName, setServerName] = useState("my-first-rag")
  const [busy, setBusy] = useState(false)

  async function start() {
    const who = username.trim()
    const srv = serverName.trim()
    if (!who) {
      toast.error("Tell us your name first.")
      return
    }
    if (!srv) {
      toast.error("Name your first server.")
      return
    }
    setBusy(true)
    try {
      await setUsername(who)
      await createServer(srv)
      toast.success(`Welcome, ${who}! "${srv}" is ready.`)
    } catch {
      toast.error("Setup failed. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog open={isFirstRun}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <div className="flex flex-col items-center gap-3 pb-1 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Boxes className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Welcome to buddy-rag
            </h2>
            <p className="mt-1 text-pretty text-sm text-muted-foreground">
              Build, index, and serve your own RAG pipelines. Let&apos;s create
              your first server.
            </p>
          </div>
        </div>

        <div className="grid gap-4 pt-2">
          <div className="grid gap-2">
            <Label htmlFor="ob-name">What should we call you?</Label>
            <Input
              id="ob-name"
              autoFocus
              value={username}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ob-server">Name your first server</Label>
            <Input
              id="ob-server"
              value={serverName}
              placeholder="my-first-rag"
              onChange={(e) => setServerName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void start()
              }}
            />
          </div>
        </div>

        <Button
          className="mt-2 w-full"
          size="lg"
          onClick={() => void start()}
          disabled={busy}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Create my first server
        </Button>
      </DialogContent>
    </Dialog>
  )
}
