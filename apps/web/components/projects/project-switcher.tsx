'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProject, type WorkspaceProject } from './project-provider';
import { ProjectFormDialog } from './project-form-dialog';
import { DeleteProjectDialog } from './delete-project-dialog';

export function ProjectSwitcher() {
  const { projects, activeProject, activateProject } = useProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceProject | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
            <FolderKanban className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            {/* <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Server
            </span> */}
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {activeProject?.name ?? 'No project'}
              </span>
              {activeProject?.running && <RunningDot />}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" sideOffset={6} className="w-(--anchor-width) min-w-65">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Your projects</DropdownMenuLabel>
            {projects.map((s) => {
              const active = s.id === activeProject?.id;
              return (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => {
                    if (!active) void activateProject(s.id);
                  }}
                  className="gap-2"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FolderKanban className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                      <span>{s.sourceCount} sources</span>
                      {s.indexed && <span>· indexed</span>}
                      {s.running && (
                        <span className="flex items-center gap-1 text-green-500">
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

          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2 h-9">
            <Plus className="size-4" />
            New project
          </DropdownMenuItem>
          {/* <DropdownMenuSeparator /> */}
          {activeProject && (
            <DropdownMenuItem onClick={() => setRenameTarget(activeProject)} className="gap-2 h-9">
              <Pencil className="size-4" />
              Rename current
            </DropdownMenuItem>
          )}
          {activeProject && projects.length > 1 && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteTarget(activeProject)}
              className="gap-2"
            >
              <Trash2 className="size-4" />
              Delete current project
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
      <ProjectFormDialog
        mode="rename"
        target={renameTarget as any}
        open={renameTarget !== null}
        onOpenChange={(o) => !o && setRenameTarget(null)}
      />
      <DeleteProjectDialog
        target={deleteTarget as any}
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      />
    </>
  );
}

function RunningDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
    </span>
  );
}
