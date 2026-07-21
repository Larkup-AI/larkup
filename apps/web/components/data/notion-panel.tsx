'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/error-formatter';
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  Database,
  FileText,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface NotionPage {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  lastEdited: string;
  parentType: string;
}

interface NotionDatabase {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  lastEdited: string;
  type: 'database';
}

interface NotionStatus {
  connected: boolean;
  configured: boolean;
  pages: NotionPage[];
  databases?: NotionDatabase[];
  error?: string;
}

export function NotionPanel({ onAdded, onClose }: { onAdded: () => void; onClose?: () => void }) {
  const {
    data: statusData,
    error: swrError,
    isLoading,
    mutate,
  } = useSWR<NotionStatus>('/api/integrations/notion', (url: string) =>
    fetch(url).then((res) => {
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    }),
  );

  const status = statusData || {
    connected: false,
    configured: false,
    pages: [],
    error: swrError ? formatErrorMessage(swrError) : undefined,
  };

  const loading = isLoading && !statusData;

  const fetchStatus = () => mutate();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [search, setSearch] = useState('');
  const [showType, setShowType] = useState<'all' | 'pages' | 'databases'>('all');

  // connectNotion removed since it's handled by IntegrationsPanel

  function togglePage(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(items: { id: string }[]) {
    const allSelected = items.every((p) => selected.has(p.id));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        items.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        items.forEach((p) => next.add(p.id));
        return next;
      });
    }
  }

  async function importSelected() {
    if (selected.size === 0) {
      toast.error('Select at least one page to import.');
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/integrations/notion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: Array.from(selected) }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Import failed');

      toast.success(
        `${data.imported} of ${data.total} page${
          data.total !== 1 ? 's' : ''
        } imported successfully`,
      );
      setSelected(new Set());
      onAdded();
    } catch (err) {
      toast.error(formatErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking Notion connection…</p>
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <img src="/notion.png" alt="Notion" className="size-6 opacity-60" />
        </div>
        <div className="text-center max-w-md">
          <h3 className="text-lg font-semibold text-foreground">Notion Not Connected</h3>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Please connect Notion from the integrations panel.
          </p>

          {status?.error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              {status.error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Connected — show pages
  const allPages = status.pages || [];
  const allDatabases = status.databases || [];
  const query = search.toLowerCase().trim();

  const filteredPages = query
    ? allPages.filter((p) => p.title.toLowerCase().includes(query))
    : allPages;

  const filteredDatabases = query
    ? allDatabases.filter((d) => d.title.toLowerCase().includes(query))
    : allDatabases;

  const visibleItems =
    showType === 'pages'
      ? filteredPages
      : showType === 'databases'
      ? filteredDatabases
      : [...filteredPages, ...filteredDatabases];

  return (
    <div className="space-y-4 ">
      {/* Connection status */}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 p-2 pt-3">
        <div className="flex items-center flex-wrap sm:flex-nowrap gap-2 min-w-0">
          <CheckCircle2 className="size-4 shrink-0 text-green-600" />
          <span className="text-sm font-medium text-foreground shrink-0">Notion Connected</span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {allPages.length} pages · {allDatabases.length} databases
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchStatus}
          className="h-7 gap-1.5 text-xs shrink-0"
        >
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-0">
        <Input
          placeholder="Search pages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 w-full"
        />
        <div className="flex items-center h-10 w-full sm:w-auto rounded-lg border border-border p-1">
          {(['all', 'pages', 'databases'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setShowType(t)}
              className={cn(
                'h-full flex-1 sm:flex-none rounded-md px-3 text-xs font-medium transition-colors capitalize',
                showType === t
                  ? 'bg-background text-foreground '
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Pages list */}
      {visibleItems.length > 0 ? (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {visibleItems.length} item{visibleItems.length !== 1 ? 's' : ''} · {selected.size}{' '}
              selected
            </span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => toggleAll(visibleItems)}
            >
              {visibleItems.every((p) => selected.has(p.id)) ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {visibleItems.map((item) => {
              const checked = selected.has(item.id);
              const isDb = 'type' in item && item.type === 'database';
              return (
                <li key={item.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50',
                      checked && 'bg-accent/50',
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => togglePage(item.id)} />
                    <span className="text-base">{item.icon || (isDb ? '📊' : '📄')}</span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {isDb ? (
                          <Database className="size-2.5" />
                        ) : (
                          <FileText className="size-2.5" />
                        )}
                        {isDb ? 'Database' : 'Page'}
                        {item.lastEdited && (
                          <>
                            <span>·</span>
                            {new Date(item.lastEdited).toLocaleDateString()}
                          </>
                        )}
                      </span>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg py-12 text-center">
          <FileText className="size-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-foreground">
            {search ? 'No pages match your search.' : 'No pages found.'}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground mt-1 max-w-[350px]">
              Make sure your integration has access to pages in Notion.
            </p>
          )}
        </div>
      )}

      {/* Import actions */}
      <DialogFooter className="mt-5 border-border/70 flex flex-row items-center justify-between sm:justify-between space-x-0 gap-2">
        <Button
          variant="destructive"
          onClick={async () => {
            setDisconnecting(true);
            try {
              const res = await fetch('/api/integrations/notion', { method: 'DELETE' });
              if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to disconnect');
              }
              toast.success('Disconnected from Notion');
              fetchStatus();
            } catch (err) {
              toast.error(formatErrorMessage(err));
            } finally {
              setDisconnecting(false);
            }
          }}
          disabled={importing || disconnecting}
        >
          {disconnecting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Disconnect
        </Button>
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={onClose} disabled={importing || disconnecting}>
            Cancel
          </Button>
          <Button
            onClick={importSelected}
            disabled={importing || disconnecting || selected.size === 0}
          >
            {importing ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <img src="/notion-white.png" alt="Notion" className="size-4 mr-2" />
            )}
            Import {selected.size} page{selected.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
