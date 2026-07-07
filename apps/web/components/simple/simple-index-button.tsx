"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { IndexRun } from "@larkup-rag/core/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ACTIVE: IndexRun["status"][] = ["chunking", "embedding", "upserting"];

export function SimpleIndexButton() {
  const [starting, setStarting] = useState(false);
  const { data, isLoading, mutate } = useSWR("/api/index", fetcher, {
    refreshInterval: (d) =>
      d?.run && ACTIVE.includes(d.run.status) ? 1000 : 0,
  });

  const run = data?.run;
  const running = Boolean(run && ACTIVE.includes(run.status));
  const ready = data?.ready;
  const unindexedCount = data?.unindexedCount || 0;

  async function build() {
    setStarting(true);
    try {
      const res = await fetch("/api/index", {
        method: "POST",
        body: JSON.stringify({ incremental: run?.status === "completed" }),
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Could not start indexing.");
        return;
      }
      toast.success("Indexing started.");
      mutate();
    } catch {
      toast.error("Could not start indexing.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Button
      onClick={build}
      disabled={
        !ready ||
        running ||
        starting ||
        (run?.status === "completed" && unindexedCount === 0)
      }
      size="sm"
    >
      {running || starting ? (
        <Loader2 className="size-4 animate-spin mr-2" />
      ) : (
        <Play className="size-4 mr-2" />
      )}
      {running
        ? "Indexing…"
        : run?.status === "completed"
          ? `Index new (${unindexedCount})`
          : "Start indexing"}
    </Button>
  );
}
