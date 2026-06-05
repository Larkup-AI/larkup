"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  KeyRound,
  Loader2,
  Package,
  Play,
  Rocket,
  Server,
  Square,
  Terminal,
} from "lucide-react"
import type { RagConfig } from "@/core/types"
import type {
  GeneratedFile,
  GeneratedServer,
} from "@/core/generator/generate-server"
import { getVectorStore } from "@/core/vector-stores/registry"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { CodeViewer } from "@/components/server/code-viewer"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface GenerateResponse {
  config: RagConfig
  server: GeneratedServer
}

interface LocalServerState {
  running: boolean
  pid?: number
  port: number
  endpoint: string
  startedAt?: string
  lastError?: string
}

export function ServerWorkspace() {
  const { data, isLoading } = useSWR<GenerateResponse>(
    "/api/server/generate",
    fetcher,
  )

  if (isLoading || !data) {
    return (
      <div className="px-6 py-6 md:px-8">
        <Skeleton className="h-[28rem] w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 px-6 py-6 md:px-8">
      <ServerSummary config={data.config} server={data.server} />
      <LaunchPanel config={data.config} />
      <FileExplorer files={data.server.files} project={data.server.projectName} />
    </div>
  )
}

function ServerSummary({
  config,
  server,
}: {
  config: RagConfig
  server: GeneratedServer
}) {
  const store = getVectorStore(config.vectorStore)
  const deps = Object.entries(server.dependencies)
  const requiredEnv = server.envVars.filter((e) => e.required)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="size-4 text-primary" />
          Generated server
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          A standalone, dependency-minimal RAG server tailored to your{" "}
          <span className="font-medium text-foreground">{store.label}</span>{" "}
          configuration. It ships only the packages this store needs — no build
          step, runs with <code className="font-mono text-xs">node server.mjs</code>.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="size-3.5" />
              Dependencies ({deps.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {deps.map(([name, version]) => (
                <Badge
                  key={name}
                  variant="secondary"
                  className="font-mono text-[11px] font-normal"
                >
                  {name}@{version}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {store.label} only — other stores are excluded from the bundle.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" />
              Required env vars ({requiredEnv.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {requiredEnv.map((e) => (
                <Badge
                  key={e.key}
                  variant="outline"
                  className="font-mono text-[11px] font-normal"
                >
                  {e.key}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Set these in <code className="font-mono">.env</code> before running.
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/server/generate?download=1"
            download
            className={buttonVariants()}
          >
            <Download className="size-4" />
            Download server (.zip)
          </a>
          <p className="text-sm text-muted-foreground">
            {server.files.length} files · ready to deploy to Docker or Vercel
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function LaunchPanel({ config }: { config: RagConfig }) {
  const [busy, setBusy] = useState<"start" | "stop" | null>(null)
  const isLocalLance =
    config.vectorStore === "lancedb" && config.storeConfig.mode !== "cloud"

  const { data, mutate } = useSWR<{ state: LocalServerState }>(
    "/api/server/local",
    fetcher,
    { refreshInterval: (d) => (d?.state.running ? 5000 : 0) },
  )
  const state = data?.state

  async function control(action: "start" | "stop") {
    setBusy(action)
    try {
      const res = await fetch("/api/server/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (action === "start") {
        if (body.state?.running) toast.success("Local server is running.")
        else toast.error(body.state?.lastError ?? "Server did not start.")
      } else {
        toast.success("Local server stopped.")
      }
      mutate()
    } catch {
      toast.error("Could not reach the local server controller.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4 text-primary" />
          Launch locally
        </CardTitle>
        {state?.running && (
          <span className="flex items-center gap-1.5 text-xs text-primary">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            running on :{state.port}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLocalLance ? (
          <Alert>
            <ExternalLink className="size-4" />
            <AlertTitle>Deploy-only for cloud stores</AlertTitle>
            <AlertDescription>
              {getVectorStore(config.vectorStore).label} runs in the cloud, so
              there&apos;s nothing to launch on this machine. Download the
              server above and deploy it to Docker or Vercel.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Spin up the generated server right here. It points at the same
              on-disk LanceDB table you indexed into, installs its minimal deps,
              and serves <code className="font-mono text-xs">/query</code> on a
              local port.
            </p>

            {state?.lastError && !state.running && (
              <Alert variant="destructive">
                <AlertTitle>Launch failed</AlertTitle>
                <AlertDescription className="break-words">
                  {state.lastError}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {state?.running ? (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => control("stop")}
                    disabled={busy !== null}
                  >
                    {busy === "stop" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Square className="size-4" />
                    )}
                    Stop server
                  </Button>
                  <a
                    href={`${state.endpoint}/health`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <ExternalLink className="size-4" />
                    {state.endpoint}
                  </a>
                </>
              ) : (
                <Button onClick={() => control("start")} disabled={busy !== null}>
                  {busy === "start" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {busy === "start" ? "Starting…" : "Launch local server"}
                </Button>
              )}
            </div>

            {state?.running && (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Terminal className="size-3.5" />
                  Try it
                </div>
                <CodeLine
                  text={`curl -X POST ${state.endpoint}/query -H "Content-Type: application/json" -d '{"query":"hello"}'`}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function FileExplorer({
  files,
  project,
}: {
  files: GeneratedFile[]
  project: string
}) {
  const [active, setActive] = useState(
    files.find((f) => f.path === "server.mjs")?.path ?? files[0]?.path,
  )
  const current = files.find((f) => f.path === active)

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCode className="size-4 text-primary" />
          <span className="font-mono text-sm">{project}/</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
          <nav className="border-b border-border md:border-b-0 md:border-r">
            <ScrollArea className="h-auto md:h-[28rem]">
              <ul className="p-2">
                {files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setActive(f.path)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
                        f.path === active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <FileCode className="size-3.5 shrink-0" />
                      <span className="truncate">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </nav>

          <div className="min-w-0">
            {current && (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {current.path}
                  </span>
                  <CopyButton text={current.contents} />
                </div>
                <div className="h-[24rem] md:h-[26rem]">
                  <CodeViewer
                    value={current.contents}
                    language={current.language}
                    height="100%"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <CheckCircle2 className="size-3.5 text-primary" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
        {text}
      </code>
      <CopyButton text={text} />
    </div>
  )
}
