"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  Server,
  Square,
  Terminal,
} from "lucide-react";

// Vercel triangle icon
function VercelIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2L2 19.778h20L12 2z" />
    </svg>
  );
}
import type { RagConfig } from "@larkup-rag/core/types";
import type {
  GeneratedFile,
  GeneratedServer,
} from "@larkup-rag/core/generator/generate-server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface GenerateResponse {
  config: RagConfig;
  server: GeneratedServer;
  serverId: string;
}

interface LocalServerState {
  running: boolean;
  pid?: number;
  port: number;
  endpoint: string;
  startedAt?: string;
  lastError?: string;
}

export function ServerWorkspace({
  onServerId,
}: {
  onServerId?: (id: string) => void;
}) {
  const { data, isLoading } = useSWR<GenerateResponse>(
    "/api/server/generate",
    fetcher,
  );

  // Notify parent of the active serverId as soon as we have it
  useEffect(() => {
    if (data?.serverId) onServerId?.(data.serverId);
  }, [data?.serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !data) {
    return (
      <div className="px-6 py-6 md:px-8">
        <Skeleton className="h-112 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 px-6 py-6 md:px-8">
      <LaunchPanel config={data.config} serverId={data.serverId} />
    </div>
  );
}

function LaunchPanel({
  config,
  serverId,
}: {
  config: RagConfig;
  serverId: string;
}) {
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteProvider, setRemoteProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    // Read deployed remote URL (set by DeployButton on success).
    // Keys are scoped per-server to avoid stale URLs from old servers.
    const url = localStorage.getItem(`vercel_deployed_url_${serverId}`);
    const provider = localStorage.getItem(
      `vercel_deployed_provider_${serverId}`,
    );
    const savedApiKey = localStorage.getItem("rag_server_api_key");
    if (url) setRemoteUrl(url);
    if (provider) setRemoteProvider(provider);
    if (savedApiKey) setApiKey(savedApiKey);
  }, [serverId]);

  const { data, mutate } = useSWR<{ state: LocalServerState }>(
    "/api/server/local",
    fetcher,
    { refreshInterval: (d) => (d?.state.running ? 5000 : 0) },
  );
  const state = data?.state;

  async function control(action: "start" | "stop") {
    setBusy(action);
    try {
      const currentApiKey = localStorage.getItem("rag_server_api_key") || "";
      const res = await fetch("/api/server/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, serverApiKey: currentApiKey }),
      });
      const body = await res.json();
      if (action === "start") {
        if (body.state?.running) toast.success("Local server is running.");
        else toast.error(body.state?.lastError ?? "Server did not start.");
      } else {
        toast.success("Local server stopped.");
      }
      mutate();
    } catch {
      toast.error("Could not reach the local server controller.");
    } finally {
      setBusy(null);
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
          <span className="flex items-center gap-1.5 text-xs text-green-700">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-green-600" />
            </span>
            running on :{state.port}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Spin up the generated server right here to test your RAG endpoints.
            Settings and API keys configured in the Deploy menu will be
            automatically applied.
          </p>

          <Alert>
            <ExternalLink className="size-4" />
            <AlertTitle>API Documentation</AlertTitle>
            <AlertDescription>
              {/* We use{" "}
              <a
                href="https://scalar.com/"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Scalar
              </a>{" "}
              for full API endpoint documentation. */}
              {state?.running ? (
                <div className="mt-0">
                  <a
                    href={`${state.endpoint}/reference`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Open API Reference
                  </a>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground text-xs">
                  Launch the local server to view the API reference.
                </p>
              )}
            </AlertDescription>
          </Alert>

          {state?.lastError && !state.running && (
            <Alert variant="destructive">
              <AlertTitle>Launch failed</AlertTitle>
              <AlertDescription className="wrap-break-word">
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
                  className={""}
                >
                  {busy === "stop" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Square className="size-4 text-white!" />
                  )}
                  Stop server
                </Button>
                <a
                  href={`${state.endpoint}/health`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  <ExternalLink className="size-4" />
                  {state.endpoint}
                </a>
              </>
            ) : (
              <>
                <Button
                  onClick={() => control("start")}
                  disabled={busy !== null}
                >
                  {busy === "start" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {busy === "start" ? "Starting…" : "Launch local server"}
                </Button>
              </>
            )}
          </div>
        </div>

        {state?.running && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Terminal className="size-3.5" />
              Try it
            </div>
            <CodeLine
              text={`curl -X POST ${state.endpoint}/query -H "Content-Type: application/json"${apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : ""} -d '{"query":"hello"}'`}
            />
          </div>
        )}

        {/* ── Remote server (deployed via Vercel / Hetzner) ── */}
        {remoteUrl && (
          <>
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground min-w-[110px]">
                {remoteProvider === "vercel" ? (
                  <VercelIcon className="size-4 shrink-0" />
                ) : (
                  <Server className="size-4 shrink-0" />
                )}
                Remote server
              </div>
              <a
                href={remoteUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                <ExternalLink className="size-4" />
                {remoteUrl.replace(/^https?:\/\//, "")}
              </a>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Terminal className="size-3.5" />
                Try remote
              </div>
              <CodeLine
                text={`curl -X POST ${remoteUrl}/query -H "Content-Type: application/json"${apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : ""} -d '{"query":"hello"}'`}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <CheckCircle2 className="size-3.5 text-primary" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
        {text}
      </code>
      <CopyButton text={text} />
    </div>
  );
}
