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
              json.state?.lastError ??
              "Waiting for the service to become healthy.",
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
    <div className="flex items-center gap-2">
      {running ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5  bg-red-500 hover:bg-red-600 text-white hover:text-white hover:border-red-200 text-xs px-2.5 shadow-none"
          onClick={() => control("stop")}
          disabled={busy !== null}
        >
          {busy === "stop" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Square className="size-3" />
          )}
          Stop Crawler
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => control("start")}
          disabled={
            busy !== null ||
            isLoading ||
            (!dockerReady && runtimeEnv !== "docker")
          }
          className="h-7 gap-1.5 text-xs px-2.5 shadow-none bg-orange-500 text-white hover:bg-orange-600 hover:text-white"
        >
          {busy === "start" ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : (
            <img
              src="/icons/firecrawl2.png"
              alt=""
              className="size-3 object-contain"
            />
          )}
          {runtimeEnv === "docker" ? "Connect Crawler" : "Launch Crawler"}
        </Button>
      )}

      {state?.lastError && !running && (
        <span
          className="text-[10px] text-destructive flex items-center gap-1 max-w-[200px] truncate"
          title={state.lastError}
        >
          <TriangleAlert className="size-3 shrink-0" />
          <span className="truncate">Error starting crawler</span>
        </span>
      )}
      {!isLoading && !dockerReady && !running && docker?.message && (
        <span
          className="text-[10px] text-destructive flex items-center gap-1 max-w-[200px] truncate"
          title={docker.message}
        >
          <TriangleAlert className="size-3 shrink-0" />
          <span className="truncate">Docker issue</span>
        </span>
      )}
    </div>
  );
}
