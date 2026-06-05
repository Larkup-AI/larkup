"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Play,
  Server,
  Square,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface LocalState {
  running: boolean
  endpoint: string
  port: number
  hasKey: boolean
  startedAt?: string
  lastError?: string
}
interface DockerState {
  docker: boolean
  compose: boolean
  message: string
}
interface LocalResponse {
  state: LocalState
  docker: DockerState
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

/**
 * Local Firecrawl launcher.
 *
 * Lets the user spin up a self-hosted Firecrawl via Docker straight from the
 * UI — no manual API key needed. We generate a bearer token automatically and
 * wire the local endpoint into the scraper, so web search + crawling work
 * against localhost. If the cloud key is already set, this stays collapsed.
 */
export function FirecrawlNotice({
  cloudConfigured = false,
  onChange,
}: {
  cloudConfigured?: boolean
  onChange?: () => void
}) {
  const { data, mutate, isLoading } = useSWR<LocalResponse>(
    "/api/firecrawl/local",
    fetcher,
    {
      refreshInterval: (d) =>
        d?.state.running || d?.state.startedAt ? 8000 : 0,
    },
  )
  const [busy, setBusy] = useState<"start" | "stop" | null>(null)

  const state = data?.state
  const docker = data?.docker
  const running = state?.running ?? false

  async function control(action: "start" | "stop") {
    setBusy(action)
    if (action === "start") {
      toast.info("Launching local Firecrawl…", {
        description: "Pulling images and starting containers. This can take a minute on first run.",
      })
    }
    try {
      const res = await fetch("/api/firecrawl/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json()) as { state?: LocalState; error?: string }
      if (!res.ok) throw new Error(json.error || "Request failed")

      if (action === "start") {
        if (json.state?.running) {
          toast.success("Local Firecrawl is running", {
            description: "Web scraping is now wired to your local instance.",
          })
        } else {
          toast.warning("Containers started", {
            description:
              json.state?.lastError ?? "Waiting for the API to become healthy.",
          })
        }
      } else {
        toast.success("Local Firecrawl stopped")
      }
      await mutate()
      onChange?.()
    } catch (err) {
      toast.error("Could not control local Firecrawl", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setBusy(null)
    }
  }

  // Cloud key present and no local instance running → nothing to show.
  if (cloudConfigured && !running && !state?.startedAt) return null

  const dockerReady = docker?.compose ?? false

  return (
    <Alert>
      {running ? (
        <Server className="size-4 text-primary" />
      ) : (
        <KeyRound className="size-4" />
      )}
      <AlertTitle className="flex items-center gap-2">
        {running ? "Local Firecrawl is running" : "Run Firecrawl locally"}
        {running && (
          <Badge variant="secondary" className="gap-1 font-normal">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            live
          </Badge>
        )}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        {running ? (
          <p className="text-sm">
            Connected to{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {state?.endpoint}
            </code>
            . A bearer token was generated automatically — web search and
            crawling use it without any setup.
          </p>
        ) : (
          <p className="text-sm">
            {cloudConfigured
              ? "You have a cloud key set. You can also run Firecrawl locally in Docker."
              : "Launch a self-hosted Firecrawl in Docker. A key is generated for you automatically — no signup required. Pasting and uploading work without it."}
          </p>
        )}

        {/* Docker readiness hint */}
        {!isLoading && !dockerReady && !running && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>{docker?.message}</span>
          </div>
        )}

        {state?.lastError && !running && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{state.lastError}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => control("stop")}
              disabled={busy !== null}
            >
              {busy === "stop" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Square className="size-4" />
              )}
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => control("start")}
              disabled={busy !== null || isLoading || !dockerReady}
            >
              {busy === "start" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Launch Firecrawl locally
            </Button>
          )}

          {dockerReady && !running && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-primary" />
              Docker ready
            </span>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
