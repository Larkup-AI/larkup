'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, FolderKanban, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useProject, type WorkspaceProject } from './project-provider';
import { ProjectFormDialog } from './project-form-dialog';
import { DeleteProjectDialog } from './delete-project-dialog';

export function ProjectSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { projects, activeProject, activateProject } = useProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceProject | null>(null);
  const [search, setSearch] = useState('');

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? projects.filter((project) => project.name.toLocaleLowerCase().includes(query))
      : projects;
  }, [search, projects]);

  return (
    <>
      <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Switch project"
              className={cn(
                'flex w-full items-center border-t border-sidebar-border/60 bg-transparent text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                collapsed ? 'justify-center px-0 py-3' : 'gap-2 px-3 py-3',
              )}
            />
          }
        >
          <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="size-4" />
            <span
              className={cn(
                'absolute bottom-0 right-0 size-2 rounded-full border border-background',
                activeProject?.running ? 'bg-emerald-500' : 'bg-muted-foreground/60',
              )}
            />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold capitalize">
                  {activeProject?.name ?? 'Create a project'}
                </span>
                <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                  {activeProject?.running ? 'Project live' : 'Not running'}
                </span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side={collapsed ? 'right' : 'top'}
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border-border bg-popover p-1.5 shadow-lg"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1 text-xs font-normal text-muted-foreground">
              Projects
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <div className="relative mb-1 px-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search projects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Search projects..."
              className="h-9 pl-8"
            />
          </div>
          <DropdownMenuGroup className="max-h-72 overflow-y-auto overscroll-contain">
            {filteredProjects.map((project) => {
              const active = project.id === activeProject?.id;
              return (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => {
                    if (!active) void activateProject(project.id);
                  }}
                  className="h-10 gap-2 rounded-lg"
                >
                  <FolderKanban className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {active && <Check className="size-4 text-primary" />}
                </DropdownMenuItem>
              );
            })}
            {!filteredProjects.length && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {projects.length ? 'No matching projects.' : 'No projects yet.'}
              </p>
            )}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="h-9 gap-2 rounded-lg">
            <Plus className="size-4" />
            New project
          </DropdownMenuItem>
          {activeProject && (
            <DropdownMenuItem
              onClick={() => setRenameTarget(activeProject)}
              className="h-9 gap-2 rounded-lg"
            >
              <Pencil className="size-4" />
              Edit current project
            </DropdownMenuItem>
          )}
          {activeProject && projects.length > 1 && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteTarget(activeProject)}
              className="h-9 gap-2 rounded-lg"
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
