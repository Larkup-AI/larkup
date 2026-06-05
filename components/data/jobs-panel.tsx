"use client"

import { toast } from "sonner"
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Octagon,
  TriangleAlert,
  Trash2,
} from "lucide-react"
import type { CrawlJob, CrawlJobStatus } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

const STATUS: Record<
  CrawlJobStatus,
  { label: string; icon: typeof Loader2; className: string }
> = {
  queued: { label: "Queued", icon: CircleDashed, className: "text-muted-foreground" },
  running: { label: "Running", icon: Loader2, className: "text-primary" },
  completed: { label: "Completed", icon: CheckCircle2, className: "text-chart-3" },
  failed: { label: "Failed", icon: TriangleAlert, className: "text-destructive" },
  cancelled: { label: "Cancelled", icon: Octagon, className: "text-muted-foreground" },
}

function progressFor(job: CrawlJob): number {
  const domainTargets = job.targets.filter((t) => t.scope === "domain").length
  const denom =
    domainTargets > 0 ? domainTargets * job.pageLimit : job.targets.length
  if (denom === 0) return 0
  if (job.status === "completed") return 100
  return Math.min(99, Math.round((job.pagesCrawled / denom) * 100))
}

export function JobsPanel({
  jobs,
  onChanged,
}: {
  jobs: CrawlJob[]
  onChanged: () => void
}) {
  async function cancel(id: string) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" })
    toast.message("Job cancelled")
    onChanged()
  }
  async function remove(id: string) {
    await fetch(`/api/jobs/${id}?remove=1`, { method: "DELETE" })
    onChanged()
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">No ETL jobs yet.</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Start a web scrape to aggregate sources here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {jobs.map((job) => {
        const s = STATUS[job.status]
        const Icon = s.icon
        const active = job.status === "running" || job.status === "queued"
        return (
          <li
            key={job.id}
            className="rounded-lg border border-border bg-card p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{job.keywords}</p>
                <p className="text-xs text-muted-foreground">
                  {job.targets.length} target
                  {job.targets.length === 1 ? "" : "s"} ·{" "}
                  {job.targets[0]?.scope === "domain"
                    ? "domain crawl"
                    : "page scrape"}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn("shrink-0 gap-1 font-mono text-[10px]", s.className)}
              >
                <Icon
                  className={cn("size-3", job.status === "running" && "animate-spin")}
                />
                {s.label}
              </Badge>
            </div>

            <div className="mt-3 space-y-1.5">
              <Progress value={progressFor(job)} className="h-1.5" />
              <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>{job.pagesCrawled} pages crawled</span>
                <span>{job.docCount} docs stored</span>
              </div>
            </div>

            {job.targets.some((t) => t.error) && (
              <p className="mt-2 line-clamp-2 text-xs text-destructive">
                {job.targets.find((t) => t.error)?.error}
              </p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              {active ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => cancel(job.id)}
                >
                  <Octagon className="size-3" />
                  Cancel
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => remove(job.id)}
                >
                  <Trash2 className="size-3" />
                  Remove
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
