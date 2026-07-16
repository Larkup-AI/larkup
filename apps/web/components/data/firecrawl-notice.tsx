"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Play,
  Server,
  Square,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/lib/error-formatter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LocalState {
  running: boolean;
  endpoint: string;
  port: number;
  hasKey: boolean;
  startedAt?: string;
  lastError?: string;
}
interface DockerState {
  docker: boolean;
  compose: boolean;
  message: string;
}
interface LocalResponse {
  state: LocalState;
  docker: DockerState;
  runtimeEnv?: "web" | "desktop" | "docker";
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Web-crawler launcher notice.
 *
 * Adapts to the runtime environment:
 * - **Web / Desktop**: lets the user spin up a self-hosted crawler via Docker.
 * - **Docker**: detects a sibling crawler service on the Docker network.
 *
 * The API key (cloud) option is managed in Settings — this component only
 * handles the local/Docker launcher.
 */
export function FirecrawlNotice({
  cloudConfigured = false,
  onChange,
  onErrorChange,
}: {
  cloudConfigured?: boolean;
  onChange?: () => void;
  onErrorChange?: (hasError: boolean) => void;
}) {
  const { data, mutate, isLoading } = useSWR<LocalResponse>(
    "/api/firecrawl/local",
    fetcher,
    {
      refreshInterval: (d) =>
        d?.state.running || d?.state.startedAt ? 8000 : 0,
    },
  );
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);

  const state = data?.state;
  const docker = data?.docker;
  const runtimeEnv = data?.runtimeEnv ?? "web";
  const running = state?.running ?? false;
  const dockerReady = docker?.compose ?? false;
  const hasError = !cloudConfigured && (!dockerReady || !!state?.lastError);

  useEffect(() => {
    if (!isLoading) {
      onErrorChange?.(hasError);
    }
  }, [hasError, isLoading, onErrorChange]);

  async function control(action: "start" | "stop") {
    setBusy(action);
    if (action === "start") {
      toast.info(
        runtimeEnv === "docker"
          ? "Connecting to crawler service…"
          : "Launching web crawler…",
        {
          description:
            runtimeEnv === "docker"
              ? "Checking if the crawler service is available on the network."
              : "Pulling images and starting containers. This can take a minute on first run.",
        },
      );
    }
    try {
      const res = await fetch("/api/firecrawl/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as { state?: LocalState; error?: string };
      if (!res.ok) throw new Error(json.error || "Request failed");

      if (action === "start") {
        if (json.state?.running) {
          toast.success("Web crawler is running", {
            description: "Web scraping is now active.",
          });
        } else {
          toast.warning("Crawler started", {
            description:
              json.state?.lastError ?? "Waiting for the service to become healthy.",
          });
        }
      } else {
        toast.success("Web crawler stopped");
      }
      await mutate();
      onChange?.();
    } catch (err) {
      toast.error("Could not control web crawler", {
        description: formatErrorMessage(err),
      });
    } finally {
      setBusy(null);
    }
  }

  // Both cloud and local options are kept available.

  // Description text based on environment
  const idleDescription = (() => {
    if (runtimeEnv === "docker") {
      return dockerReady
        ? "A crawler service was found on the network. Click to connect."
        : "Start your deployment with the crawler profile to enable web scraping: docker compose --profile crawler up";
    }
    if (cloudConfigured) {
      return "You have a cloud key set. You can also run the crawler locally via Docker.";
    }
    return "Launch a self-hosted web crawler via Docker. A key is generated automatically — no signup required. Pasting and uploading work without it.";
  })();

  return (
    <Alert>
      {running ? (
        <Server className="size-4 text-primary" />
      ) : (
        <KeyRound className="size-4" />
      )}
      <AlertTitle className="flex items-center gap-2">
        {running ? (
          <>
            <img
              src="/icons/firecrawl2.png"
              alt=""
              className="size-4 object-contain"
            />
            Web Crawler is running
          </>
        ) : (
          <>
            <img
              src="/icons/firecrawl2.png"
              alt=""
              className="size-4 object-contain"
            />
            Launch Web Crawler
          </>
        )}
        {running && (
          <Badge
            variant="secondary"
            className="gap-1 font-normal text-green-600"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-green-500" />
            </span>
            live
          </Badge>
        )}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-0">
        {running ? (
          <p className="text-sm">
            Connected to{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {state?.endpoint}
            </code>
            . Web search and crawling are active.
          </p>
        ) : (
          <p className="text-sm">{idleDescription}</p>
        )}

        {/* Docker readiness hint */}
        {!isLoading && !dockerReady && !running && docker?.message && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>{formatErrorMessage(docker.message)}</span>
          </div>
        )}

        {state?.lastError && !running && (
          <div className="flex items-start mb-3 gap-2 max-h-[200px]! overflow-auto rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{formatErrorMessage(state.lastError)}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pb-2">
          {running ? (
            <Button
              size="sm"
              variant="destructive"
              className={"bg-red-500 hover:bg-red-500/80 text-white "}
              onClick={() => control("stop")}
              disabled={busy !== null}
            >
              {busy === "stop" ? (
                <Loader2 className="size-4 animate-spin text-white" />
              ) : (
                <Square className="size-4 text-white!" />
              )}
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => control("start")}
              disabled={busy !== null || isLoading || (!dockerReady && runtimeEnv !== "docker")}
              className="
    inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium
    bg-[#F97316] hover:bg-[#EA6C0A]
    text-white border-none
    rounded-md transition-all duration-200
    disabled:opacity-70 disabled:cursor-not-allowed
  "
            >
              {busy === "start" ? (
                <Loader2 className="size-4 animate-spin text-white" />
              ) : (
                <img
                  src="/icons/firecrawl2.png"
                  alt=""
                  className="size-4 object-contain"
                />
              )}
              {runtimeEnv === "docker" ? "Connect" : "Launch"}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
