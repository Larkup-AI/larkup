'use client';

import { useEffect, useState } from 'react';
import {
  Cable,
  CheckIcon,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  XCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { GenericAlert } from '@/components/alerts/generic-alert';
import { Badge } from '../../ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type McpConnection = {
  id: string;
  name: string;
  url: string;
  transport: 'http' | 'sse';
  connectionType: 'direct' | 'proxy';
  proxyUrl?: string;
  proxyAuthToken?: string;
  proxyAuthHeader?: string;
  headers: Record<string, string>;
  enabled: boolean;
  enabledForLocalChat: boolean;
};

type Draft = Omit<McpConnection, 'id' | 'enabled'>;

const emptyDraft = (): Draft => ({
  name: '',
  url: '',
  transport: 'http',
  connectionType: 'direct',
  proxyUrl: '',
  proxyAuthToken: '',
  proxyAuthHeader: 'Authorization',
  headers: {},
  enabledForLocalChat: true,
});

function parseHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const headers: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error('Use one header per line: Name: value');
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return headers;
}

/* Status pill. */
function StatusIndicator({
  status,
  toolCount,
}: {
  status?: 'testing' | 'connected' | 'disconnected';
  toolCount: number;
}) {
  if (!status) return null;

  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Loader2 className="size-3.5 animate-spin text-amber-500 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Testing…</span>
      </span>
    );
  }

  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckIcon className="size-3.5 rounded-full bg-emerald-600 p-0.5 text-white dark:bg-emerald-500" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          Connected
        </span>
        <Badge
          variant="secondary"
          className="ml-0.5 px-1.5 py-0 text-[10px] font-semibold leading-4"
        >
          {toolCount} tool{toolCount !== 1 ? 's' : ''}
        </Badge>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <XCircle className="size-3.5 text-destructive" />
      <span className="text-xs font-medium text-destructive">Disconnected</span>
    </span>
  );
}

/* Connection card. */
function ConnectionCard({
  connection,
  testResult,
  isTesting,
  onToggle,
  onTest,
  onDelete,
  onEdit,
}: {
  connection: McpConnection;
  testResult?: { status: 'testing' | 'connected' | 'disconnected'; toolCount: number };
  isTesting: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className="group flex flex-wrap items-center gap-4 rounded-xl border border-border bg-white/70 px-4 py-3.5 transition-colors hover:border-primary/20 hover:bg-white/90 dark:bg-card/60 dark:hover:border-primary/30 dark:hover:bg-card/80 cursor-pointer"
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onEdit()}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white dark:border-border/60 dark:bg-secondary/70">
        <img src="/icons/mcp.svg" alt="" className="size-5 object-contain" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{connection.name}</p>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
            {connection.transport === 'sse' ? 'SSE' : 'HTTP'}
          </Badge>
          {connection.connectionType === 'proxy' && (
            <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
              Proxy
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{connection.url}</p>
      </div>

      <StatusIndicator status={testResult?.status} toolCount={testResult?.toolCount ?? 0} />

      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={connection.enabled}
          onCheckedChange={onToggle}
          aria-label={`Enable ${connection.name}`}
        />

        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={onTest}
                  disabled={isTesting}
                >
                  {isTesting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipContent side="bottom">Test connection</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={onDelete}
                  aria-label={`Remove ${connection.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="bottom">Remove connection</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

export function McpConnectionsSection() {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [headersText, setHeadersText] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<McpConnection | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [testResults, setTestResults] = useState<
    Record<string, { status: 'testing' | 'connected' | 'disconnected'; toolCount: number }>
  >({});

  // ── Edit dialog state ──
  const [editTarget, setEditTarget] = useState<McpConnection | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [editHeadersText, setEditHeadersText] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const silentTestConnection = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: { status: 'testing', toolCount: 0 } }));
    try {
      const response = await fetch(`/api/mcp/${id}/test`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error();
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'connected', toolCount: data.toolCount || 0 },
      }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [id]: { status: 'disconnected', toolCount: 0 } }));
    }
  };

  const load = async () => {
    try {
      const response = await fetch('/api/mcp');
      if (!response.ok) throw new Error('Could not load MCP connections');
      const data = (await response.json()) as { connections: McpConnection[] };
      setConnections(data.connections);
      data.connections.forEach((c) => void silentTestConnection(c.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load MCP connections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setDraft(emptyDraft());
    setHeadersText('');
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { proxyUrl, proxyAuthToken, proxyAuthHeader, ...connection } = draft;
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...connection,
          ...(draft.connectionType === 'proxy'
            ? {
                proxyUrl,
                proxyAuthToken,
                proxyAuthHeader,
              }
            : {}),
          headers: parseHeaders(headersText),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add MCP connection');
      setConnections((current) => [...current, data]);
      setDialogOpen(false);
      void silentTestConnection(data.id);
      toast.success('MCP connected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add MCP connection');
    } finally {
      setSaving(false);
    }
  };

  const update = async (connection: McpConnection, patch: Partial<McpConnection>) => {
    const response = await fetch(`/api/mcp/${connection.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update MCP connection');
    setConnections((current) => current.map((item) => (item.id === connection.id ? data : item)));
  };

  const testConnection = async (connection: McpConnection) => {
    setTestingId(connection.id);
    setTestResults((prev) => ({ ...prev, [connection.id]: { status: 'testing', toolCount: 0 } }));
    try {
      const response = await fetch(`/api/mcp/${connection.id}/test`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connection test failed');
      setTestResults((prev) => ({
        ...prev,
        [connection.id]: { status: 'connected', toolCount: data.toolCount || 0 },
      }));
      toast.success(`Connected — ${data.toolCount} tool${data.toolCount === 1 ? '' : 's'} found`);
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [connection.id]: { status: 'disconnected', toolCount: 0 },
      }));
      toast.error(error instanceof Error ? error.message : 'Connection test failed');
    } finally {
      setTestingId(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      const response = await fetch(`/api/mcp/${toDelete.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not remove MCP');
      setConnections((current) => current.filter((item) => item.id !== toDelete.id));
      toast.success('MCP connection removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove MCP');
    } finally {
      setToDelete(null);
    }
  };

  // ── Edit helpers ──
  const openEdit = (connection: McpConnection) => {
    setEditTarget(connection);
    setEditDraft({
      name: connection.name,
      url: connection.url,
      transport: connection.transport,
      connectionType: connection.connectionType,
      proxyUrl: connection.proxyUrl ?? '',
      proxyAuthToken: connection.proxyAuthToken ?? '',
      proxyAuthHeader: connection.proxyAuthHeader ?? 'Authorization',
      headers: connection.headers ?? {},
      enabledForLocalChat: connection.enabledForLocalChat,
    });
    setEditHeadersText(
      Object.entries(connection.headers ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
    );
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const { proxyUrl, proxyAuthToken, proxyAuthHeader, ...rest } = editDraft;
      const payload: Partial<McpConnection> = {
        ...rest,
        ...(editDraft.connectionType === 'proxy'
          ? { proxyUrl, proxyAuthToken, proxyAuthHeader }
          : {}),
        headers: parseHeaders(editHeadersText),
      };
      await update(editTarget, payload);
      setEditTarget(null);
      void silentTestConnection(editTarget.id);
      toast.success('Connection updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update connection');
    } finally {
      setEditSaving(false);
    }
  };

  const filtered = connections.filter(
    (c) =>
      !search.trim() ||
      c.name.toLowerCase().includes(search.trim().toLowerCase()) ||
      c.url.toLowerCase().includes(search.trim().toLowerCase()),
  );

  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginatedConnections = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Card className="bg-transparent border-none">
      <CardContent className="space-y-4">
        <div className="w-full gap-3 flex items-center justify-between">
          {!loading && connections.length > 0 && (
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search connections…"
                className="h-9 pl-9 w-full bg-white/70"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap items-start justify-between gap-4">
            {connections.length > 0 && (
              <Button onClick={openCreate} size="default" className="gap-1.5 px-3">
                <Plus className="size-3.5" /> Add MCP
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading connections…
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-xl  px-4 py-20 dark:bg-card/40">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl border border-border  dark:bg-secondary/70">
                <img src="/icons/mcp.svg" alt="MCP" className="size-7 object-contain" />
              </div>
              <div className="text-center">
                <h2 className="text-base font-semibold tracking-tight">No MCP connections yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add a remote MCP endpoint to discover its tools.
                </p>
              </div>
              <Button onClick={openCreate} className="mt-2 gap-1.5">
                <Plus className="size-4" /> Add MCP
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-white/60 px-4 py-14 dark:bg-card/40">
            <AlertCircle className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No connections match &ldquo;{search}&rdquo;
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {paginatedConnections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                testResult={testResults[connection.id]}
                isTesting={testingId === connection.id}
                onToggle={(enabled) =>
                  void update(connection, { enabled }).catch((error) => toast.error(error.message))
                }
                onTest={() => void testConnection(connection)}
                onDelete={() => setToDelete(connection)}
                onEdit={() => openEdit(connection)}
              />
            ))}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to{' '}
                  {Math.min(page * pageSize, filtered.length)} of {filtered.length} connections
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground mx-2">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl! overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add MCP connection</DialogTitle>
            <DialogDescription>
              Supports remote Streamable HTTP and SSE. Store MCP credentials in headers, never in a
              URL.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="mcp-name"
                placeholder="Customer support"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                disabled={saving}
              />
            </div>

            {/* Transport + Connection type */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>
                  Transport <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={draft.transport}
                  onValueChange={(transport) =>
                    setDraft({ ...draft, transport: transport as Draft['transport'] })
                  }
                  disabled={saving}
                >
                  <SelectTrigger className="w-full">
                    {draft.transport === 'sse' ? 'SSE' : 'Streamable HTTP'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">SSE (legacy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>
                  Connection type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={draft.connectionType}
                  onValueChange={(connectionType) =>
                    setDraft({
                      ...draft,
                      connectionType: connectionType as Draft['connectionType'],
                    })
                  }
                  disabled={saving}
                >
                  <SelectTrigger className="w-full" aria-label="Connection type">
                    {draft.connectionType === 'proxy' ? 'Proxy' : 'Direct'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="proxy">Proxy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Server URL */}
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-url">
                Server URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="mcp-url"
                inputMode="url"
                placeholder="https://mcp.example.com/mcp"
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                disabled={saving}
              />
            </div>

            {/* Proxy config */}
            {draft.connectionType === 'proxy' && (
              <div className="grid gap-4 rounded-lg border border-dashed bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-medium">Proxy configuration</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    MCP traffic is sent to this proxy instead of the MCP server URL above.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-proxy-url">
                    Proxy URL <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="mcp-proxy-url"
                    inputMode="url"
                    placeholder="https://proxy.example.com/mcp"
                    value={draft.proxyUrl ?? ''}
                    onChange={(event) => setDraft({ ...draft, proxyUrl: event.target.value })}
                    disabled={saving}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-proxy-token">
                    Proxy auth token{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="mcp-proxy-token"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Proxy access token"
                    value={draft.proxyAuthToken ?? ''}
                    onChange={(event) => setDraft({ ...draft, proxyAuthToken: event.target.value })}
                    disabled={saving}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-proxy-auth-header">Proxy auth header</Label>
                  <Input
                    id="mcp-proxy-auth-header"
                    placeholder="Authorization"
                    value={draft.proxyAuthHeader ?? 'Authorization'}
                    onChange={(event) =>
                      setDraft({ ...draft, proxyAuthHeader: event.target.value })
                    }
                    disabled={saving}
                  />
                </div>
              </div>
            )}

            {/* Headers */}
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-headers">
                Headers <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="mcp-headers"
                className="min-h-24 font-mono text-xs"
                placeholder={'Authorization: Bearer your-token\nX-Workspace: acme'}
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !draft.name.trim() || !draft.url.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Connecting…
                </>
              ) : (
                'Add connection'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit connection dialog. */}
      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl! overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4" />
              Edit connection
            </DialogTitle>
            <DialogDescription>
              Update the configuration for{' '}
              <span className="font-medium text-foreground">{editTarget?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="edit-mcp-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-mcp-name"
                placeholder="Customer support"
                value={editDraft.name}
                onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                disabled={editSaving}
              />
            </div>

            {/* Transport + Connection type */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>
                  Transport <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={editDraft.transport}
                  onValueChange={(v) =>
                    setEditDraft({ ...editDraft, transport: v as Draft['transport'] })
                  }
                  disabled={editSaving}
                >
                  <SelectTrigger className="w-full">
                    {editDraft.transport === 'sse' ? 'SSE' : 'Streamable HTTP'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">SSE (legacy)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>
                  Connection type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={editDraft.connectionType}
                  onValueChange={(v) =>
                    setEditDraft({
                      ...editDraft,
                      connectionType: v as Draft['connectionType'],
                    })
                  }
                  disabled={editSaving}
                >
                  <SelectTrigger className="w-full" aria-label="Connection type">
                    {editDraft.connectionType === 'proxy' ? 'Proxy' : 'Direct'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="proxy">Proxy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Server URL */}
            <div className="grid gap-1.5">
              <Label htmlFor="edit-mcp-url">
                Server URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-mcp-url"
                inputMode="url"
                placeholder="https://mcp.example.com/mcp"
                value={editDraft.url}
                onChange={(e) => setEditDraft({ ...editDraft, url: e.target.value })}
                disabled={editSaving}
              />
            </div>

            {/* Proxy config */}
            {editDraft.connectionType === 'proxy' && (
              <div className="grid gap-4 rounded-lg border border-dashed bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-medium">Proxy configuration</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    MCP traffic is sent to this proxy instead of the MCP server URL above.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-mcp-proxy-url">
                    Proxy URL <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-mcp-proxy-url"
                    inputMode="url"
                    placeholder="https://proxy.example.com/mcp"
                    value={editDraft.proxyUrl ?? ''}
                    onChange={(e) => setEditDraft({ ...editDraft, proxyUrl: e.target.value })}
                    disabled={editSaving}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-mcp-proxy-token">
                    Proxy auth token{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="edit-mcp-proxy-token"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Proxy access token"
                    value={editDraft.proxyAuthToken ?? ''}
                    onChange={(e) => setEditDraft({ ...editDraft, proxyAuthToken: e.target.value })}
                    disabled={editSaving}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-mcp-proxy-auth-header">Proxy auth header</Label>
                  <Input
                    id="edit-mcp-proxy-auth-header"
                    placeholder="Authorization"
                    value={editDraft.proxyAuthHeader ?? 'Authorization'}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, proxyAuthHeader: e.target.value })
                    }
                    disabled={editSaving}
                  />
                </div>
              </div>
            )}

            {/* Headers */}
            <div className="grid gap-1.5">
              <Label htmlFor="edit-mcp-headers">
                Headers <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="edit-mcp-headers"
                className="min-h-24 font-mono text-xs"
                placeholder={'Authorization: Bearer your-token\nX-Workspace: acme'}
                value={editHeadersText}
                onChange={(e) => setEditHeadersText(e.target.value)}
                disabled={editSaving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveEdit()}
              disabled={editSaving || !editDraft.name.trim() || !editDraft.url.trim()}
            >
              {editSaving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenericAlert
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Remove MCP connection"
        description={`Remove "${toDelete?.name}"? It will no longer be available to Local Chat or Agents.`}
        actionText="Remove"
        variant="destructive"
        onAction={() => void remove()}
      />
    </Card>
  );
}
