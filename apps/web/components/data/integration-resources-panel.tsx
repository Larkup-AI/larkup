'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CheckCircle2, Loader2, RefreshCw, Search, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useIntegrationAuth } from '@/hooks/use-integration-auth';
import { toast } from 'sonner';

interface Resource {
  id: string;
  title: string;
  url?: string;
  kind?: string;
}
interface Status {
  connected: boolean;
  resources: Resource[];
  error?: string;
}

export function IntegrationResourcesPanel({
  integration,
  name,
  icon,
  onAdded,
  onClose,
}: {
  integration: string;
  name: string;
  icon: string;
  onAdded: () => void;
  onClose: () => void;
}) {
  const endpoint = `/api/integrations/${integration}`;
  const { data, isLoading, mutate } = useSWR<Status>(endpoint, (url: string) =>
    fetch(url).then(async (response) => {
      const payload = await response.json();
      if (!response.ok && !payload.connected) return payload;
      if (!response.ok) throw new Error(payload.error);
      return payload;
    }),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const resources = data?.resources ?? [];

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources) {
      if (r.kind) set.add(r.kind);
    }
    return ['all', ...Array.from(set).sort()];
  }, [resources]);

  const filteredResources = useMemo(() => {
    return resources.filter((r) => {
      if (activeTab !== 'all' && r.kind !== activeTab) return false;
      if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [resources, search, activeTab]);

  const { connect } = useIntegrationAuth({
    onSuccess: () => {
      toast.success(`${name} connected`);
      mutate();
    },
    onError: (error) => toast.error(error),
  });
  const allSelected = useMemo(
    () =>
      filteredResources.length > 0 &&
      filteredResources.every((resource) => selected.has(resource.id)),
    [filteredResources, selected],
  );

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to disconnect');
      toast.success(`${name} disconnected`);
      setSelected(new Set());
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to disconnect ${name}`);
    } finally {
      setDisconnecting(false);
    }
  }

  async function importSelected() {
    if (!selected.size) return toast.error('Select at least one item to import.');
    setImporting(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceIds: [...selected] }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      toast.success(`${payload.imported} of ${payload.total} items imported`);
      setSelected(new Set());
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  if (isLoading)
    return (
      <div className="flex justify-center gap-2 p-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking connection…
      </div>
    );
  if (!data?.connected)
    return (
      <div className="flex w-full min-w-0 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 py-12 text-center">
          <img src={icon} alt="" className="size-9 object-contain" />
          <div>
            <h3 className="text-lg font-semibold">Connect {name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Read and import selected knowledge into your corpus.
            </p>
            {data?.error && <p className="mt-2 text-xs text-destructive">{data.error}</p>}
          </div>
          <Button onClick={() => connect(integration)}>Connect {name}</Button>
        </div>
        {data?.error && (
          <DialogFooter className="m-0! flex flex-row items-center justify-between space-x-0 gap-2 border-t border-border/70 bg-muted/50 p-4 sm:justify-between">
            <Button variant="destructive" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Unplug className="size-4 mr-2" />
              )}
              Disconnect
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        )}
      </div>
    );
  return (
    <div className="flex flex-col">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-4 text-green-600" />
            {name} connected{' '}
            <span className="text-muted-foreground">· {resources.length} items</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => mutate()}
              className="h-7 shrink-0 gap-1.5 text-xs"
            >
              <RefreshCw className="size-3" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${resources.length} items...`}
              className="h-9 pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {kinds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {kinds.map((kind) => {
                const isActive = activeTab === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setActiveTab(kind)}
                    className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      isActive
                        ? 'bg-muted text-foreground'
                        : 'border border-border bg-transparent text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {kind}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          <label className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-3 py-2 text-sm font-medium">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (allSelected) {
                    filteredResources.forEach((r) => next.delete(r.id));
                  } else {
                    filteredResources.forEach((r) => next.add(r.id));
                  }
                  return next;
                })
              }
            />
            Select all
          </label>
          {filteredResources.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No items match your filters.
            </div>
          ) : (
            filteredResources.map((resource) => (
              <label
                key={resource.id}
                className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-0 hover:bg-muted/30"
              >
                <Checkbox
                  checked={selected.has(resource.id)}
                  onCheckedChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      next.has(resource.id) ? next.delete(resource.id) : next.add(resource.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate text-sm">{resource.title}</span>
                {resource.kind && (
                  <span className="text-[10px] text-muted-foreground">{resource.kind}</span>
                )}
              </label>
            ))
          )}
        </div>
      </div>
      <DialogFooter className="m-0! flex flex-row items-center justify-between space-x-0 gap-2 border-t border-border/70 bg-muted/50 p-4 sm:justify-between">
        <Button variant="destructive" onClick={disconnect} disabled={importing || disconnecting}>
          {disconnecting ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Unplug className="size-4 mr-2" />
          )}
          Disconnect
        </Button>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={onClose} disabled={importing || disconnecting}>
            Cancel
          </Button>
          <Button disabled={!selected.size || importing || disconnecting} onClick={importSelected}>
            {importing && <Loader2 className="mr-2 size-4 animate-spin" />}
            Import {selected.size || ''} selected
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
