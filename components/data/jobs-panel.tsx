"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Octagon,
  TriangleAlert,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react"
import type { CrawlJob, CrawlJobStatus } from "@/core/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 8

const STATUS: Record<
  CrawlJobStatus,
  { label: string; icon: typeof Loader2; className: string; badgeVariant: string }
> = {
  queued: {
    label: "Queued",
    icon: CircleDashed,
    className: "text-muted-foreground border-muted-foreground/30 bg-muted/30",
    badgeVariant: "outline",
  },
  running: {
    label: "Running",
    icon: Loader2,
    className: "text-primary border-primary/30 bg-primary/10",
    badgeVariant: "outline",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
    badgeVariant: "outline",
  },
  failed: {
    label: "Failed",
    icon: TriangleAlert,
    className: "text-destructive border-destructive/30 bg-destructive/10",
    badgeVariant: "outline",
  },
  cancelled: {
    label: "Cancelled",
    icon: Octagon,
    className: "text-muted-foreground border-muted-foreground/30 bg-muted/30",
    badgeVariant: "outline",
  },
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
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<{
    ids: string[]
    label: string
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageJobs = jobs.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const allPageSelected =
    pageJobs.length > 0 && pageJobs.every((j) => selected.has(j.id))
  const somePageSelected = pageJobs.some((j) => selected.has(j.id))

  function toggleAll() {
    const next = new Set(selected)
    if (allPageSelected) {
      pageJobs.forEach((j) => next.delete(j.id))
    } else {
      pageJobs.forEach((j) => next.add(j.id))
    }
    setSelected(next)
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  async function cancel(id: string) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" })
    toast.message("Job cancelled")
    onChanged()
  }

  async function executeDelete(ids: string[]) {
    setDeleting(true)
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/jobs/${id}?remove=1`, { method: "DELETE" }),
        ),
      )
      setSelected((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      toast.success(
        ids.length === 1 ? "Job removed" : `${ids.length} jobs removed`,
      )
      onChanged()
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  function requestDelete(ids: string[]) {
    const label =
      ids.length === 1
        ? `"${jobs.find((j) => j.id === ids[0])?.keywords ?? ids[0]}"`
        : `${ids.length} selected jobs`
    setConfirmDelete({ ids, label })
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">No ETL jobs yet.</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Start a web scrape to aggregate sources here.
        </p>
      </div>
    )
  }

  const selectedArray = Array.from(selected)
  const removableSelected = selectedArray.filter((id) => {
    const j = jobs.find((j) => j.id === id)
    return j && j.status !== "running" && j.status !== "queued"
  })

  return (
    <>
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-1.5">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1.5 text-xs text-destructive hover:text-destructive"
            disabled={removableSelected.length === 0}
            onClick={() => requestDelete(removableSelected)}
          >
            <Trash2 className="size-3" />
            Delete ({removableSelected.length})
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="w-full overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 pl-1 pr-2 text-left">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all on page"
                  className="size-3.5"
                />
              </th>
              <th className="pb-2 pr-3 text-left font-medium text-muted-foreground">
                Title / Keywords
              </th>
              <th className="pb-2 pr-3 text-right font-medium text-muted-foreground whitespace-nowrap">
                Pages
              </th>
              <th className="pb-2 pr-3 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="pb-2 text-right font-medium text-muted-foreground" />
            </tr>
          </thead>
          <tbody>
            {pageJobs.map((job) => {
              const s = STATUS[job.status]
              const Icon = s.icon
              const active =
                job.status === "running" || job.status === "queued"
              const pct = progressFor(job)

              return (
                <tr
                  key={job.id}
                  className={cn(
                    "border-b border-border/50 transition-colors last:border-0",
                    selected.has(job.id) && "bg-muted/30",
                  )}
                >
                  {/* Checkbox */}
                  <td className="py-2 pl-1 pr-2">
                    <Checkbox
                      checked={selected.has(job.id)}
                      onCheckedChange={() => toggleOne(job.id)}
                      aria-label={`Select job ${job.keywords}`}
                      className="size-3.5"
                    />
                  </td>

                  {/* Title */}
                  <td className="py-2 pr-3 max-w-[9rem]">
                    <p className="truncate font-medium text-foreground leading-tight">
                      {job.keywords}
                    </p>
                    <p className="text-muted-foreground/70 text-[10px]">
                      {job.targets.length} target
                      {job.targets.length === 1 ? "" : "s"}
                    </p>
                  </td>

                  {/* Pages crawled + progress */}
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <span className="text-foreground">{job.pagesCrawled}</span>
                    {active && (
                      <div className="mt-1 h-0.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </td>

                  {/* Status badge */}
                  <td className="py-2 pr-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap",
                        s.className,
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-2.5 shrink-0",
                          job.status === "running" && "animate-spin",
                        )}
                      />
                      {s.label}
                    </Badge>
                  </td>

                  {/* Action */}
                  <td className="py-2 text-right">
                    {active ? (
                      <button
                        onClick={() => cancel(job.id)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                        title="Cancel job"
                      >
                        <Octagon className="size-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => requestDelete([job.id])}
                        className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove job"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, jobs.length)} of {jobs.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded p-1 hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <button
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded p-1 hover:bg-muted disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Confirm delete dialog */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Confirm deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-medium text-foreground">
                {confirmDelete?.label}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() =>
                confirmDelete && executeDelete(confirmDelete.ids)
              }
            >
              {deleting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
