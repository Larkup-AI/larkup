'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/error-formatter';
import {
  FileText,
  Trash2,
  FileUp,
  Globe,
  Pencil,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Film,
  Upload,
  Type,
  Image,
  Plug,
  ChevronDown,
  Check,
  X,
  Eye,
  EyeOff,
  Monitor,
  Cloud,
  Info,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DocumentSource, SourceDocument, DataGroup } from '@larkup/core/types';
import { GenericAlert } from '@/components/alerts/generic-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import {
  videoRuntimeScopeFromMetadata,
  videoRuntimeScopeLabel,
  type VideoRuntimeScope,
} from '@/lib/media/video-runtime-scope';

const SOURCE_META: Record<DocumentSource, { label: string; icon: any }> = {
  website: { label: 'Website', icon: Globe },
  text: { label: 'Text', icon: Type },
  files: { label: 'Files', icon: FileUp },
  media: { label: 'Media', icon: Image },
  integrations: { label: 'Integrations', icon: Plug },
};

export function CorpusPanel({
  documents,
  groups = [],
  onChanged,
  isIndexing,
  activeVideoRuntimeScope,
}: {
  documents: SourceDocument[];
  groups?: DataGroup[];
  onChanged: () => void | Promise<unknown>;
  isIndexing?: boolean;
  activeVideoRuntimeScope: VideoRuntimeScope;
}) {
  const [active, setActive] = useState<SourceDocument | null>(null);
  const [deleteTask, setDeleteTask] = useState<
    { type: 'single'; doc: SourceDocument } | { type: 'all' } | { type: 'selected' } | null
  >(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorDoc, setInspectorDoc] = useState<SourceDocument | null>(null);

  const [page, setPage] = useState(0);

  const [sourceFilter, setSourceFilter] = useState<DocumentSource | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'indexed' | 'unindexed'>('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);

  const groupedDocuments = useMemo(() => {
    const grouped = new Map<string, SourceDocument>();
    const others: SourceDocument[] = [];

    for (const doc of documents) {
      if (doc.source === 'media' && doc.metadata?.mediaAssetId) {
        const id = doc.metadata.mediaAssetId;
        if (!grouped.has(id)) {
          grouped.set(id, {
            ...doc,
            id: `media-group-${id}`,
            title: doc.metadata.fileName || doc.title || 'Media Asset',
            charCount: doc.charCount,
            metadata: { ...doc.metadata, isGroup: true, childIds: [doc.id] },
          });
        } else {
          const existing = grouped.get(id)!;
          existing.charCount += doc.charCount;
          existing.metadata!.childIds.push(doc.id);
          if (doc.status !== 'indexed') existing.status = doc.status;
        }
      } else {
        others.push(doc);
      }
    }
    return [...Array.from(grouped.values()), ...others].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [documents]);

  const filteredDocuments = groupedDocuments.filter(
    (document) =>
      (sourceFilter === 'all' || document.source === sourceFilter) &&
      (statusFilter === 'all' || (document.status ?? 'unindexed') === statusFilter) &&
      (selectedGroupIds.size === 0 || selectedGroupIds.has(document.groupId ?? 'default')),
  );

  useEffect(() => {
    setPage(0);
  }, [sourceFilter, statusFilter, selectedGroupIds]);

  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageDocuments = filteredDocuments.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const legacyVideoCount = groupedDocuments.filter(
    (document) =>
      document.source === 'media' &&
      document.metadata?.isGroup &&
      !videoRuntimeScopeFromMetadata(document.metadata),
  ).length;

  const allPageSelected =
    pageDocuments.length > 0 && pageDocuments.every((d) => selectedIds.has(d.id));

  async function deleteRequest(url: string) {
    const response = await fetch(url, { method: 'DELETE' });
    if (response.ok) return;

    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Could not delete this document.');
  }

  async function del(id: string, doc?: SourceDocument) {
    try {
      if (doc?.metadata?.isGroup && doc?.metadata?.mediaAssetId) {
        await deleteRequest(`/api/media?id=${doc.metadata.mediaAssetId}`);
      } else {
        await deleteRequest(`/api/documents?id=${id}`);
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await onChanged();
      toast.success('Document deleted');
    } catch (error) {
      toast.error(formatErrorMessage(error) || 'Could not delete this document.');
    }
  }
  async function delSelected() {
    if (selectedIds.size === 0) return;
    const toDelete = groupedDocuments.filter((d) => selectedIds.has(d.id));
    try {
      for (const doc of toDelete) {
        if (doc.metadata?.isGroup && doc.metadata?.mediaAssetId) {
          await deleteRequest(`/api/media?id=${doc.metadata.mediaAssetId}`);
        } else {
          await deleteRequest(`/api/documents?id=${doc.id}`);
        }
      }
      setSelectedIds(new Set());
      await onChanged();
      toast.success(`Deleted ${toDelete.length} item(s)`);
    } catch (error) {
      toast.error(formatErrorMessage(error) || 'Could not delete the selected documents.');
    }
  }
  async function clearAll() {
    try {
      await deleteRequest('/api/documents');
      setSelectedIds(new Set());
      await onChanged();
      toast.success('Corpus and vector index cleared');
    } catch (error) {
      toast.error(formatErrorMessage(error) || 'Could not clear the corpus.');
    }
  }

  const isAllSelected = selectedGroupIds.size === 0;
  const selectedGroupLabels = useMemo(() => {
    if (isAllSelected) return 'All Groups';
    return Array.from(selectedGroupIds)
      .map((id) => {
        const g = groups.find((g) => g.id === id);
        return g ? (g.icon ? `${g.icon} ${g.name}` : g.name) : id;
      })
      .join(', ');
  }, [selectedGroupIds, groups, isAllSelected]);

  function toggleGroupFilter(groupId: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function clearGroupFilter() {
    setSelectedGroupIds(new Set());
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col  items-center justify-center rounded-lg   px-6 py-14 text-center">
        <div className="size-10 p-1.5 bg-white/60 border border-border  rounded-md flex items-center justify-center">
          <FileText className="size-7 text-muted-foreground/60" />
        </div>
        <p className="mt-3 text-lg font-medium">Your corpus is empty</p>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Scrape the web, paste text, or upload files. Everything you collect is stored locally and
          ready to index in the next step.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'All Sources' },
              ...Object.entries(SOURCE_META).map(([key, meta]) => ({ id: key, label: meta.label })),
            ].map((tab) => {
              const isActive = sourceFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSourceFilter(tab.id as any)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'border border-border bg-transparent text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={groupDropdownOpen} onOpenChange={setGroupDropdownOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-9  items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 shadow-none',
                    !isAllSelected && 'border-primary/40 bg-primary/5 text-primary',
                  )}
                  aria-label="Filter by group"
                >
                  <span className="max-w-40 truncate">{selectedGroupLabels}</span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>
              }
            />
            <PopoverContent align="start" className="w-56 p-1.5 shadow-none">
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={clearGroupFilter}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                    isAllSelected && 'bg-accent/60 font-medium',
                  )}
                >
                  <div
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border border-primary/40',
                      isAllSelected ? 'bg-primary border-primary' : 'bg-white',
                    )}
                  >
                    {isAllSelected && <Check className="size-2.5 text-white" strokeWidth={3} />}
                  </div>
                  All Groups
                </button>
                {groups.length > 0 && <div className="my-1 border-t border-border" />}
                {groups.map((group) => {
                  const isChecked = selectedGroupIds.has(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => toggleGroupFilter(group.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5  text-xs transition-colors hover:bg-accent',
                        isChecked && 'bg-accent/60',
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border border-primary/40',
                          isChecked ? 'bg-primary border-primary' : 'bg-white',
                        )}
                      >
                        {isChecked && <Check className="size-2.5 text-white" strokeWidth={3} />}
                      </div>
                      <span className="flex-1 truncate text-left">
                        {group.icon ? `${group.icon} ` : ''}
                        {group.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Select
            value={statusFilter}
            onValueChange={(v) => v && setStatusFilter(v as 'all' | 'indexed' | 'unindexed')}
          >
            <SelectTrigger className="w-29 shadow-none border-border/70 bg-white h-9! text-xs">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="indexed">Indexed</SelectItem>
              <SelectItem value="unindexed">Unindexed</SelectItem>
            </SelectContent>
          </Select>
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 text-xs border-destructive/30 hover:border-destructive/50 hover:text-white hover:bg-destructive  bg-destructive text-white "
              onClick={() => setDeleteTask({ type: 'selected' })}
            >
              <Trash2 className="size-3.5" />
              Delete {selectedIds.size} selected
            </Button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="destructive"
                    aria-label="Clear all data"
                    className="h-9 border border-border text-xs"
                    onClick={() => setDeleteTask({ type: 'all' })}
                    disabled={isIndexing}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent>Clear all data</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {legacyVideoCount > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {legacyVideoCount} existing video{legacyVideoCount === 1 ? '' : 's'} will stay available
            until re-indexed. Re-index a video once to link it to{' '}
            {videoRuntimeScopeLabel(activeVideoRuntimeScope)} and enable runtime-specific
            visibility.
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-12">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      const next = new Set(selectedIds);
                      pageDocuments.forEach((d) => next.add(d.id));
                      setSelectedIds(next);
                    } else {
                      const next = new Set(selectedIds);
                      pageDocuments.forEach((d) => next.delete(d.id));
                      setSelectedIds(next);
                    }
                  }}
                  aria-label="Select all on page"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-28">Source</TableHead>
              <TableHead className="w-24 text-right">Chars</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody className="bg-white/70">
            {pageDocuments.map((doc) => {
              const meta = SOURCE_META[doc.source as DocumentSource] || {
                label: doc.source || 'Unknown',
                icon: FileText,
              };
              const Icon = meta.icon;
              const indexedRuntimeScope =
                doc.source === 'media' ? videoRuntimeScopeFromMetadata(doc.metadata) : undefined;
              const unavailableInActiveRuntime =
                Boolean(indexedRuntimeScope) && indexedRuntimeScope !== activeVideoRuntimeScope;
              const runtimeLabel = indexedRuntimeScope
                ? videoRuntimeScopeLabel(indexedRuntimeScope)
                : undefined;
              const RuntimeIcon = indexedRuntimeScope === 'local' ? Monitor : Cloud;
              return (
                <TableRow
                  key={doc.id}
                  className={cn(
                    'border-border/50 h-10.5! transition-opacity',
                    unavailableInActiveRuntime && 'opacity-45 hover:opacity-70',
                  )}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(doc.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedIds);
                        if (checked) next.add(doc.id);
                        else next.delete(doc.id);
                        setSelectedIds(next);
                      }}
                      aria-label="Select document"
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => !doc.metadata?.isGroup && setActive(doc)}
                      className={cn(
                        'group flex flex-col items-start text-left',
                        doc.metadata?.isGroup ? 'cursor-default' : 'cursor-pointer',
                      )}
                    >
                      <span
                        className={cn(
                          'line-clamp-1 text-sm font-medium',
                          !doc.metadata?.isGroup && 'group-hover:text-primary',
                        )}
                      >
                        {doc.title}
                      </span>
                      {doc.metadata?.isGroup && (
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="line-clamp-1">
                            Video ({doc.metadata.childIds?.length} chunks)
                          </span>
                          {unavailableInActiveRuntime && runtimeLabel && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                                    <EyeOff className="size-2.5" />
                                    {indexedRuntimeScope === 'local' ? 'Local only' : 'Cloud only'}
                                  </span>
                                }
                              />
                              <TooltipContent className="max-w-64 text-center">
                                This video was indexed with {runtimeLabel}. It is not available to
                                the agent while {videoRuntimeScopeLabel(activeVideoRuntimeScope)} is
                                selected. Switch runtimes or re-index the video.
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {!indexedRuntimeScope && (
                            <span className="shrink-0 text-[9px] text-muted-foreground/70">
                              Legacy index
                            </span>
                          )}
                        </div>
                      )}
                      {/* {doc.url && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {doc.url}
                        </span>
                      )} */}
                    </button>
                  </TableCell>
                  <TableCell>
                    {doc.status === 'indexed' ? (
                      <Badge
                        variant="outline"
                        className="text-green-600 bg-green-50/10 border-green-500 font-normal"
                      >
                        Indexed
                      </Badge>
                    ) : isIndexing ? (
                      <Badge
                        variant="outline"
                        className="text-blue-500 bg-blue-50 border-blue-200 font-normal flex items-center gap-1.5"
                      >
                        <Loader2 className="size-3 animate-spin" />
                        Indexing
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-orange-500 bg-orange-50 border-orange-200 font-normal"
                      >
                        Unindexed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <Icon className="size-3" />
                        {meta.label}
                      </Badge>
                      {doc.metadata?.isGroup &&
                        indexedRuntimeScope &&
                        !unavailableInActiveRuntime && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <RuntimeIcon className="size-2.5" />
                            {indexedRuntimeScope === 'local' ? 'Local' : 'Cloud'}
                          </span>
                        )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {doc.charCount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-4">
                      {!doc.metadata?.isGroup && (
                        <button
                          type="button"
                          aria-label="Edit document"
                          onClick={() => setActive(doc)}
                          className="text-muted-foreground transition-colors hover:text-primary"
                        >
                          <Pencil className="size-4" />
                        </button>
                      )}
                      {doc.metadata?.isGroup && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                aria-label="View indexed video evidence"
                                onClick={() => setInspectorDoc(doc)}
                                className="text-muted-foreground transition-colors hover:text-primary"
                              >
                                <Eye className="size-4" />
                              </button>
                            }
                          />
                          <TooltipContent>View indexed video evidence</TooltipContent>
                        </Tooltip>
                      )}
                      <button
                        type="button"
                        aria-label="Delete document"
                        onClick={() => setDeleteTask({ type: 'single', doc })}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredDocuments.length === 0 ? 0 : safePage * PAGE_SIZE + 1}–
            {Math.min((safePage + 1) * PAGE_SIZE, filteredDocuments.length)} of{' '}
            {filteredDocuments.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded p-1 hover:bg-muted disabled:opacity-40 transition-colors cursor-pointer"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <button
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded p-1 hover:bg-muted disabled:opacity-40 transition-colors cursor-pointer"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <DocumentDialog
        doc={active}
        onOpenChange={(o) => !o && setActive(null)}
        onSaved={() => {
          setActive(null);
          onChanged();
        }}
        onDelete={(id) => {
          if (active) {
            setDeleteTask({ type: 'single', doc: active });
          }
        }}
      />

      <VideoKnowledgeInspector
        doc={inspectorDoc}
        allDocuments={documents}
        onClose={() => setInspectorDoc(null)}
      />

      <GenericAlert
        open={deleteTask !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTask(null);
        }}
        title={
          deleteTask?.type === 'all'
            ? 'Clear corpus'
            : deleteTask?.type === 'selected'
              ? 'Delete selected documents'
              : 'Delete document'
        }
        description={
          deleteTask?.type === 'all' ? (
            'Delete every uploaded file and document from this knowledge base? This also clears the vector index and cannot be undone.'
          ) : deleteTask?.type === 'selected' ? (
            `Are you sure you want to delete ${selectedIds.size} selected documents?`
          ) : (
            <span className="wrap-break-word">
              Are you sure you want to delete "
              <span className="break-all font-medium">
                {deleteTask?.type === 'single' ? deleteTask.doc.title : ''}
              </span>
              "?
            </span>
          )
        }
        actionText="Delete"
        variant="destructive"
        onAction={() => {
          if (deleteTask?.type === 'all') {
            void clearAll();
          } else if (deleteTask?.type === 'selected') {
            void delSelected();
          } else if (deleteTask?.type === 'single') {
            void del(deleteTask.doc.id, deleteTask.doc);
            if (active?.id === deleteTask.doc.id) {
              setActive(null);
            }
          }
        }}
      />
    </TooltipProvider>
  );
}

function VideoKnowledgeInspector({
  doc,
  allDocuments,
  onClose,
}: {
  doc: SourceDocument | null;
  allDocuments: SourceDocument[];
  onClose: () => void;
}) {
  if (!doc || !doc.metadata?.isGroup) return null;

  const childIds: string[] = doc.metadata?.childIds ?? [];
  const children = childIds
    .map((id: string) => allDocuments.find((d) => d.id === id))
    .filter((d): d is SourceDocument => d !== undefined)
    .sort((a, b) => {
      const aStart = a.metadata?.startSecs ?? 0;
      const bStart = b.metadata?.startSecs ?? 0;
      return aStart - bStart;
    });

  return (
    <Dialog open={!!doc} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full pb-3 max-w-5xl! max-h-[90%]! h-full!">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="size-4 text-muted-foreground" />
            {doc.title}
          </DialogTitle>
          <DialogDescription>
            {children.length} indexed segment{children.length !== 1 ? 's' : ''} ·{' '}
            {doc.charCount.toLocaleString()} total characters
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 pr-4">
            {children.map((child, index) => {
              const startSecs = child.metadata?.startSecs;
              const hasTimestamp = typeof startSecs === 'number';
              return (
                <div
                  key={child.id}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {hasTimestamp
                        ? `${Math.floor(startSecs / 60)}:${String(
                            Math.floor(startSecs % 60),
                          ).padStart(2, '0')}`
                        : `Segment ${index + 1}`}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                      {child.charCount.toLocaleString()} chars
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap wrap-break-word text-xs leading-relaxed text-foreground font-mono">
                    {child.content}
                  </pre>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter className="h-full">
          <Button variant="outline" onClick={onClose} className={''}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDialog({
  doc,
  onOpenChange,
  onSaved,
  onDelete,
}: {
  doc: SourceDocument | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (doc) {
      setEditing(false);
      setTitle(doc.title);
      setUrl(doc.url ?? '');
      setContent(doc.content);
    }
  }, [doc]);

  async function save() {
    if (!doc) return;
    if (!content.trim()) {
      toast.error("Content can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: doc.id,
          title: title.trim() || 'Untitled',
          url: url.trim(),
          content,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(
          body.error ? formatErrorMessage(new Error(body.error)) : 'Failed to save document.',
        );
        return;
      }
      toast.success('Document saved');
      onSaved();
    } catch (err) {
      toast.error(formatErrorMessage(err) || 'Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/media', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload file');
      }

      const data = await res.json();
      if (data.assets && data.assets.length > 0) {
        setUrl(`/api/media/${data.assets[0].id}`);
        toast.success('File uploaded and URL updated');
      }
    } catch (err) {
      toast.error(formatErrorMessage(err) || 'Failed to upload');
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-5xl!  ">
        <DialogHeader>
          <DialogTitle className="text-balance">
            {editing ? 'Edit document' : doc?.title}
          </DialogTitle>
          {!editing && doc?.url && (
            <DialogDescription className="break-all">{doc.url}</DialogDescription>
          )}
          {editing && (
            <DialogDescription>
              Changes are saved to this server&apos;s corpus. Re-index to apply them to search.
            </DialogDescription>
          )}
        </DialogHeader>

        {editing ? (
          <div
            className="grid gap-4 overflow-y-auto pr-2 pb-2 "
            style={{ maxHeight: 'calc(80vh - 150px)' }}
          >
            <div className="grid gap-2">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="doc-url">URL (optional)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] uppercase font-medium text-primary hover:bg-primary/10"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingMedia}
                >
                  {uploadingMedia ? (
                    <Loader2 className="size-3 mr-1 animate-spin" />
                  ) : (
                    <Upload className="size-3 mr-1" />
                  )}
                  Upload File
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                  accept="image/*,video/*,audio/*"
                />
              </div>
              <Input
                id="doc-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="doc-content">Content</Label>
                <span className="text-xs text-muted-foreground tabular-nums ">
                  {content.length.toLocaleString()} chars
                </span>
              </div>
              <Textarea
                id="doc-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                className="resize-none font-mono text-xs leading-relaxed"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {doc?.source === 'media' && doc?.url && (
              <div className="rounded-md border border-border bg-muted/30 overflow-hidden flex items-center justify-center p-4">
                {doc.metadata?.mediaType === 'video' ? (
                  <video src={doc.url} controls className="max-h-[40vh] max-w-full" />
                ) : doc.metadata?.mediaType === 'audio' ? (
                  <audio src={doc.url} controls className="w-full" />
                ) : (
                  <img
                    src={doc.url}
                    alt={doc.title}
                    className="max-h-[40vh] max-w-full object-contain"
                  />
                )}
              </div>
            )}
            <ScrollArea className="max-h-[60vh] rounded-md border border-border bg-muted/30">
              <pre
                className={cn(
                  'whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed text-foreground',
                )}
              >
                {doc?.content}
              </pre>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                <X className="size-4" />
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                className="text-white hover:text-white hover:bg-destructive/80"
                onClick={() => doc && onDelete(doc.id)}
              >
                <Trash2 className="size-4 mr-2" />
                Delete
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Pencil className="size-4 mr-2" />
                Edit
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
