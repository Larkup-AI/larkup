"use client";

import { useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Pencil,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace, type WorkspaceServer } from "./workspace-provider";
import { ServerFormDialog } from "./server-form-dialog";
import { DeleteServerDialog } from "./delete-server-dialog";
import { Separator } from "../ui/separator";

export function ServerSwitcher() {
  const { servers, activeServer, activateServer } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceServer | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceServer | null>(
    null,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex min-w-[300px] items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Server className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Server
            </span>
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {activeServer?.name ?? "No server"}
              </span>
              {activeServer?.running && <RunningDot />}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-[var(--anchor-width)] min-w-[260px]"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your servers</DropdownMenuLabel>
            {servers.map((s) => {
              const active = s.id === activeServer?.id;
              return (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => {
                    if (!active) void activateServer(s.id);
                  }}
                  className="gap-2"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Server className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                      <span>{s.docCount} docs</span>
                      {s.indexed && <span>· indexed</span>}
                      {s.running && (
                        <span className="flex items-center gap-1 text-primary">
                          <RunningDot />
                          live
                        </span>
                      )}
                    </span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="gap-2 h-9"
          >
            <Plus className="size-4" />
            New server
          </DropdownMenuItem>
          {/* <DropdownMenuSeparator /> */}
          {activeServer && (
            <DropdownMenuItem
              onClick={() => setRenameTarget(activeServer)}
              className="gap-2 h-9"
            >
              <Pencil className="size-4" />
              Rename current
            </DropdownMenuItem>
          )}
          {activeServer && servers.length > 1 && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteTarget(activeServer)}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              Delete current
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ServerFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      <ServerFormDialog
        mode="rename"
        target={renameTarget}
        open={renameTarget !== null}
        onOpenChange={(o) => !o && setRenameTarget(null)}
      />
      <DeleteServerDialog
        target={deleteTarget}
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      />
    </>
  );
}

function RunningDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-primary" />
    </span>
  );
}
