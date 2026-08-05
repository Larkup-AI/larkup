'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CheckCircle2, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
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
  const resources = data?.resources ?? [];
  const { connect } = useIntegrationAuth({
    onSuccess: () => {
      toast.success(`${name} connected`);
      mutate();
    },
    onError: (error) => toast.error(error),
  });
  const allSelected = useMemo(
    () => resources.length > 0 && resources.every((resource) => selected.has(resource.id)),
    [resources, selected],
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
      <div className="flex flex-col items-center gap-4 p-4 py-12 text-center">
        <img src={icon} alt="" className="size-9 object-contain" />
        <div>
          <h3 className="text-lg font-semibold">Connect {name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Read and import selected knowledge into your corpus.
          </p>
          {data?.error && <p className="mt-2 text-xs text-destructive">{data.error}</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => connect(integration)}>Connect {name}</Button>
          {data?.error && (
            <Button variant="destructive" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              Disconnect
            </Button>
          )}
        </div>
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
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => mutate()}>
              <RefreshCw className="mr-1 size-3" />
              Refresh
            </Button>
            <Button variant="destructive" size="sm" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <Unplug className="mr-1 size-3" />
              )}
              Disconnect
            </Button>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          <label className="flex items-center gap-3 border-b px-3 py-2 text-sm font-medium">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() =>
                setSelected(
                  allSelected ? new Set() : new Set(resources.map((resource) => resource.id)),
                )
              }
            />
            Select all
          </label>
          {resources.map((resource) => (
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
          ))}
        </div>
      </div>
      <DialogFooter className="!m-0 border-t bg-muted/50 p-4">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button disabled={!selected.size || importing} onClick={importSelected}>
          {importing && <Loader2 className="mr-2 size-4 animate-spin" />}Import selected
        </Button>
      </DialogFooter>
    </div>
  );
}
