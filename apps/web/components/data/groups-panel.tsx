'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { FolderPlus, Grid2X2, List, Plus, Dices } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DataGroup } from '@larkup/core/types';

const fetcher = (url: string) => fetch(url).then((response) => response.json());
type GroupSummary = DataGroup & { sourceCount: number };

export function GroupsPanel({
  onAddToGroup,
  onView,
}: {
  onAddToGroup: (groupId: string) => void;
  onView: (groupId: string) => void;
}) {
  const { data, mutate } = useSWR<{ groups: GroupSummary[]; ungroupedCount: number }>(
    '/api/groups',
    fetcher,
  );
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const groups = data?.groups ?? [];

  const filteredGroups = groups.filter((group) =>
    group.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return toast.error('Enter a group name.');
    const response = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, icon: icon.trim() || undefined }),
    });
    if (!response.ok)
      return toast.error(
        (await response.json().catch(() => ({}))).error || 'Could not create group.',
      );
    setName('');
    setIcon('');
    setOpen(false);
    await mutate();
    toast.success(`Created ${trimmed}.`);
  }

  async function setAvailability(group: GroupSummary, assistantEnabled: boolean) {
    const response = await fetch('/api/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: group.id, assistantEnabled }),
    });
    if (!response.ok) return toast.error('Could not update group availability.');
    await mutate();
  }

  function generateRandomIcon() {
    const emojis = [
      '🚀',
      '🌟',
      '📚',
      '🛠️',
      '💡',
      '🔥',
      '⚙️',
      '📈',
      '🎨',
      '🧩',
      '🧪',
      '🌍',
      '⚡',
      '🏆',
      '🎯',
      '📦',
      '🧠',
      '🛡️',
      '💎',
      '📱',
      '🕹️',
      '🔮',
    ];
    setIcon(emojis[Math.floor(Math.random() * emojis.length)]);
  }

  return (
    <section className="px-6 py-2 md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto w-full max-w-md flex-1">
          <Input
            placeholder="Search groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full bg-white"
          />
        </div>
        <div className="flex rounded-md border p-0.5 bg-white">
          <TooltipProvider delay={250}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant={view === 'cards' ? 'secondary' : 'ghost'}
                    className="size-8"
                    onClick={() => setView('cards')}
                    aria-label="Card view"
                  >
                    <Grid2X2 className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>Card view</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delay={250}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant={view === 'table' ? 'secondary' : 'ghost'}
                    className="size-8"
                    onClick={() => setView('table')}
                    aria-label="Table view"
                  >
                    <List className="size-4" />
                  </Button>
                }
              />
              <TooltipContent>Table view</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Button size="default" className="h-9" onClick={() => setOpen(true)}>
          <FolderPlus className="mr-2 size-4" /> New group
        </Button>
      </div>
      {view === 'cards' ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {filteredGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onAdd={onAddToGroup}
              onAvailability={setAvailability}
              onView={onView}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border">
          {filteredGroups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 border-b px-3 py-2.5 last:border-0 bg-white/70 cursor-pointer hover:bg-white/90"
              onClick={() => onView(group.id)}
            >
              <span className="text-lg">{group.icon || '✦'}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
              <span className="text-xs text-muted-foreground">{group.sourceCount} sources</span>
              <Availability group={group} onChange={setAvailability} />
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToGroup(group.id);
                }}
              >
                <Plus className="size-3" /> Add
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              Use an optional emoji or image URL. A unique icon is chosen automatically when left
              blank.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void create()}
                placeholder="Support docs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-icon">
                Icon or image URL <span className="text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="group-icon"
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  placeholder="📘 or https://…"
                />
                <TooltipProvider delay={250}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="shrink-0 h-10 w-9"
                          onClick={generateRandomIcon}
                          aria-label="Generate random icon"
                        >
                          <Dices className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Random icon</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()}>Create group</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Availability({
  group,
  onChange,
}: {
  group: GroupSummary;
  onChange: (group: GroupSummary, value: boolean) => void;
}) {
  return (
    <TooltipProvider delay={250}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span>
              <Switch
                checked={group.assistantEnabled}
                onCheckedChange={(value) => void onChange(group, value)}
                aria-label={`Make ${group.name} available to Assistant`}
              />
            </span>
          }
        />
        <TooltipContent>
          {group.assistantEnabled ? 'Available to Assistant chat' : 'Hidden from Assistant chat'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function GroupCard({
  group,
  onAdd,
  onAvailability,
  onView,
}: {
  group: GroupSummary;
  onAdd: (id: string) => void;
  onAvailability: (group: GroupSummary, value: boolean) => void;
  onView: (id: string) => void;
}) {
  const image = group.icon?.startsWith('http');
  return (
    <div
      className="rounded-xl border bg-card p-3 transition-colors hover:border-primary/30 cursor-pointer"
      onClick={() => onView(group.id)}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-lg">
          {image ? (
            <img src={group.icon} alt="" className="size-full object-cover" />
          ) : (
            group.icon || '✦'
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{group.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{group.sourceCount} sources</p>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Availability group={group} onChange={onAvailability} />
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3 w-full"
        onClick={(e) => {
          e.stopPropagation();
          onAdd(group.id);
        }}
      >
        <Plus className="size-3.5" /> Add data
      </Button>
    </div>
  );
}
