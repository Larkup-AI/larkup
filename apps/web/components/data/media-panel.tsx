'use client';

import { useRef, useState, useEffect } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/error-formatter';
import {
  Image as ImageIcon,
  Video,
  AudioLines,
  Loader2,
  X,
  Upload,
  FileUp,
  Check,
  AlertCircle,
  Clock,
  Trash2,
  Store,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type MediaSubTab = 'images' | 'video' | 'audio';

interface MediaAsset {
  id: string;
  type: 'image' | 'video' | 'audio';
  fileName: string;
  mimeType: string;
  storageUri: string;
  thumbnailUri?: string;
  fileSize: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
  caption?: string;
  documentIds: string[];
  createdAt: string;
  dimensions?: { width: number; height: number };
  durationSecs?: number;
}

interface StagedMedia {
  id: string;
  file: File;
  type: 'image' | 'video' | 'audio';
  preview?: string;
}

interface MediaApiResponse {
  assets: MediaAsset[];
  stats: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    totalBytes: number;
  };
  storage: { usedBytes: number; fileCount: number };
}

let globalStagedMedia: Record<string, StagedMedia[]> = { image: [], video: [], audio: [] };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getMediaType(file: File): 'image' | 'video' | 'audio' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

const SUB_TABS: { id: MediaSubTab; label: string; icon: typeof ImageIcon; accept: string }[] = [
  { id: 'images', label: 'Images', icon: ImageIcon, accept: 'image/*' },
  { id: 'video', label: 'Video', icon: Video, accept: 'video/*' },
  { id: 'audio', label: 'Audio', icon: AudioLines, accept: 'audio/*' },
];

const TAB_TO_TYPE: Record<MediaSubTab, 'image' | 'video' | 'audio'> = {
  images: 'image',
  video: 'video',
  audio: 'audio',
};

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<MediaApiResponse>);

const toolFetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ tools: any[] }>);

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function MediaPanel({ onAdded }: { onAdded: () => void }) {
  const [activeTab, setActiveTab] = useState<MediaSubTab>('images');
  const mediaType = TAB_TO_TYPE[activeTab];

  const { data, mutate, isLoading } = useSWR(`/api/media?type=${mediaType}`, fetcher, {
    refreshInterval: 5000,
  });

  const { data: toolsData, mutate: mutateTools } = useSWR('/api/marketplace', toolFetcher);

  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;
  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : '/api/config';
  const { data: configData } = useSWR(configUrl, (url) => fetch(url).then((r) => r.json()));

  // Check if Video & Audio tool is installed and enabled
  const videoAudioTool = toolsData?.tools?.find((t: any) => t.id === 'video-audio');
  const isToolInstalled = videoAudioTool?.status === 'installed';
  const enabledTools = configData?.config?.enabledTools;
  const isToolEnabled = enabledTools
    ? enabledTools.length === 0 || enabledTools.includes('video-audio')
    : true;

  const needsTool = activeTab !== 'images' && !isToolInstalled;
  const isToolDisabled = activeTab !== 'images' && isToolInstalled && !isToolEnabled;

  const assets = data?.assets ?? [];
  const storageBytes = data?.storage?.usedBytes ?? 0;

  return (
    <div className="space-y-5">
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-1 border border-border/90 rounded-lg bg-muted/60 p-1">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const count = data?.stats?.byType?.[TAB_TO_TYPE[tab.id]] ?? 0;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md',
                  isActive
                    ? 'bg-background text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                )}
              >
                <Icon className="size-3.5" strokeWidth={isActive ? 2 : 1.75} />
                {tab.label}
                {count > 0 && (
                  <span
                    className={cn(
                      'flex h-4 items-center justify-center rounded-full px-1.5 text-[10px] tabular-nums',
                      isActive
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-secondary/50 text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Storage usage (subtle) */}
        {storageBytes > 0 && (
          <div className="text-[11px] text-muted-foreground/50 tabular-nums">
            {formatSize(storageBytes)} used
          </div>
        )}
      </div>

      {/* Content: either install prompt or upload + gallery */}
      {needsTool ? (
        <InstallPrompt
          toolId="video-audio"
          toolName={videoAudioTool?.name ?? 'Video & Audio'}
          toolDescription={
            videoAudioTool?.description ??
            'Process video and audio files with transcription and frame analysis.'
          }
          installSize={videoAudioTool?.installSize ?? '~15 MB'}
          systemDeps={videoAudioTool?.systemDeps}
          onInstallComplete={() => mutateTools()}
        />
      ) : isToolDisabled ? (
        <DisabledPrompt />
      ) : (
        <MediaContent
          mediaType={mediaType}
          tab={activeTab}
          assets={assets}
          isLoading={isLoading}
          storageUsedBytes={data?.storage?.usedBytes ?? 0}
          onMutate={() => mutate()}
          onUploadComplete={() => {
            mutate();
            onAdded();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Install prompt (for Video & Audio tab when tool not installed)       */
/* ------------------------------------------------------------------ */

function InstallPrompt({
  toolId,
  toolName,
  toolDescription,
  installSize,
  systemDeps,
  onInstallComplete,
}: {
  toolId: string;
  toolName: string;
  toolDescription: string;
  installSize: string;
  systemDeps?: string[];
  onInstallComplete: () => void;
}) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const res = await fetch(`/api/marketplace/${toolId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Install failed');
      }
      toast.success('Tool installed successfully');
      onInstallComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to install tool');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-14 items-center border border-border/90 justify-center rounded-xl bg-white">
        <Store className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-medium text-foreground">{toolName}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        {toolDescription}
      </p>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground/90">
        <span>{installSize}</span>
        {/* {systemDeps?.length ? (
          <>
            <span>·</span>
            <span>Requires: {systemDeps.join(', ')}</span>
          </>
        ) : null} */}
      </div>
      <Button
        variant="default"
        size="sm"
        className="mt-5 gap-1.5 text-[12px]"
        disabled={installing}
        onClick={handleInstall}
      >
        {installing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Store className="size-3.5" />
        )}
        {installing ? 'Installing...' : 'Install directly'}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Disabled prompt (for Video & Audio tab when tool is disabled)        */
/* ------------------------------------------------------------------ */

function DisabledPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-14 items-center border border-border/90 justify-center rounded-xl bg-white">
        <AlertCircle className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-medium text-foreground">
        Video & Audio Processing Disabled
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        The Video & Audio tool is currently disabled in your agent settings. You cannot index new
        video or audio files until it is re-enabled.
      </p>
      <Button
        variant="default"
        size="sm"
        className="mt-5 text-[12px]"
        render={<Link href="/settings?tab=prompts">Go to Settings</Link>}
      />
    </div>
  );
}

function MediaContent({
  mediaType,
  tab,
  assets,
  isLoading,
  storageUsedBytes,
  onMutate,
  onUploadComplete,
}: {
  mediaType: 'image' | 'video' | 'audio';
  tab: MediaSubTab;
  assets: MediaAsset[];
  isLoading: boolean;
  storageUsedBytes: number;
  onMutate: () => void;
  onUploadComplete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStagedState] = useState<StagedMedia[]>(globalStagedMedia[mediaType] || []);

  useEffect(() => {
    setStagedState(globalStagedMedia[mediaType] || []);
  }, [mediaType]);

  const setStaged = (val: React.SetStateAction<StagedMedia[]>) => {
    setStagedState((prev) => {
      const next = typeof val === 'function' ? (val as Function)(prev) : val;
      globalStagedMedia[mediaType] = next;
      return next;
    });
  };

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{
    message?: string;
    current: number;
    total: number;
  } | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);

  const accept = SUB_TABS.find((t) => t.id === tab)?.accept ?? '*/*';

  function handleFiles(files: FileList | File[]) {
    const newFiles: StagedMedia[] = [];
    for (const file of Array.from(files)) {
      const type = getMediaType(file);
      if (type !== mediaType) {
        toast.error(`${file.name} is not a${mediaType === 'audio' ? 'n' : ''} ${mediaType} file`);
        continue;
      }
      const id = Math.random().toString(36).slice(2);
      let preview: string | undefined;
      if (type === 'image') preview = URL.createObjectURL(file);
      newFiles.push({ id, file, type, preview });
    }
    if (newFiles.length > 0) setStaged((prev) => [...prev, ...newFiles]);
  }

  function removeFile(id: string) {
    setStaged((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  }

  async function uploadAll() {
    if (staged.length === 0) return;
    setUploading(true);

    const BATCH_SIZE = 5;
    let uploaded = 0;
    const total = staged.length;
    setProgress({ message: 'Starting upload...', current: 0, total });

    try {
      for (let i = 0; i < staged.length; i += BATCH_SIZE) {
        setProgress({ message: 'Uploading files...', current: uploaded, total });
        const batch = staged.slice(i, i + BATCH_SIZE);
        const formData = new FormData();
        batch.forEach((item) => formData.append('file', item.file));

        const res = await fetch('/api/media', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Upload failed');
        }

        uploaded += batch.length;
        setProgress({ message: 'Uploading files...', current: uploaded, total });
      }

      toast.success(`${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded`);

      // Auto-trigger processing for images
      const mediaRes = await fetch(`/api/media?type=${mediaType}`);
      const mediaData = await mediaRes.json();
      const pendingIds = (mediaData.assets ?? [])
        .filter((a: MediaAsset) => a.processingStatus === 'pending')
        .map((a: MediaAsset) => a.id);

      if (pendingIds.length > 0) {
        let processed = 0;
        const PROCESS_BATCH_SIZE = 5;
        for (let i = 0; i < pendingIds.length; i += PROCESS_BATCH_SIZE) {
          const batch = pendingIds.slice(i, i + PROCESS_BATCH_SIZE);
          await Promise.all(
            batch.map(async (id: string) => {
              setProgress({
                message: 'Processing media...',
                current: processed,
                total: pendingIds.length,
              });
              try {
                await fetch('/api/media/process', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ assetIds: [id] }),
                });
              } catch (e) {
                console.error('Media processing failed:', e);
              }
              processed++;
              setProgress({
                message: 'Processing media...',
                current: processed,
                total: pendingIds.length,
              });
            }),
          );
        }
      }

      staged.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      globalStagedMedia[mediaType] = [];
      setStaged([]);
      setUploading(false);
      setProgress(null);

      onUploadComplete();
    } catch (err) {
      toast.error(formatErrorMessage(err));
      setUploading(false);
      setProgress(null);
    }
  }

  async function handleDelete(assetId: string) {
    try {
      await fetch(`/api/media?id=${assetId}`, { method: 'DELETE' });
      toast.success('File removed');
      onMutate();
    } catch {
      toast.error('Failed to delete');
    }
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/20',
        )}
      >
        <Upload className="size-5 text-muted-foreground" />
        <div className="text-center">
          <p className="text-[13px] font-medium text-foreground">
            Drop {mediaType} files here or click to browse
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {mediaType === 'image' && 'PNG, JPG, WebP, GIF, SVG'}
            {mediaType === 'video' && 'MP4, WebM, MOV, AVI'}
            {mediaType === 'audio' && 'MP3, WAV, OGG, M4A, FLAC'}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Staged files */}
      {staged.length > 0 && (
        <div className="space-y-3">
          {/* Progress */}
          {progress && (
            <div className="space-y-1.5 pb-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>
                  {progress.message || `Uploading ${progress.current} of ${progress.total}`}
                </span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} className="h-1.5" />
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-foreground">
              {staged.length} file{staged.length !== 1 ? 's' : ''} ready
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  staged.forEach((f) => {
                    if (f.preview) URL.revokeObjectURL(f.preview);
                  });
                  setStaged([]);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Clear All
              </button>
              <Button
                onClick={uploadAll}
                disabled={uploading || staged.length === 0}
                size="sm"
                className="h-7 text-xs px-3"
              >
                {uploading ? (
                  <Loader2 className="size-3 animate-spin mr-1.5" />
                ) : (
                  <FileUp className="size-3 mr-1.5" />
                )}
                Upload {staged.length} file{staged.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>

          <div className="max-h-[350px] overflow-y-auto pr-1">
            {/* Grid preview for staged images */}
            {mediaType === 'image' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {staged.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    className="group relative aspect-[4/3] rounded-xl overflow-hidden bg-muted/30 border border-border/50"
                  >
                    {item.preview && (
                      <img
                        src={item.preview}
                        alt={item.file.name}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(item.id);
                      }}
                      className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {staged.length > 8 && (
                  <div className="flex items-center justify-center rounded-xl bg-muted/30 border border-border/50 text-muted-foreground text-sm font-medium aspect-[4/3]">
                    +{staged.length - 8} more
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {staged.slice(0, 10).map((item) => {
                  const Icon = mediaType === 'video' ? Video : AudioLines;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 group"
                    >
                      <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                        <Icon className="size-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-foreground">
                          {item.file.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatSize(item.file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}
                {staged.length > 10 && (
                  <div className="flex items-center justify-center py-2 text-xs text-muted-foreground border border-dashed rounded-lg bg-muted/10">
                    +{staged.length - 10} more files
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gallery of uploaded assets */}
      {isLoading && assets.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-border bg-muted/20">
            <h4 className="text-[13px] font-medium text-foreground">
              {assets.length} Uploaded {mediaType === 'image' ? 'Image' : 'File'}
              {assets.length !== 1 ? 's' : ''}
            </h4>
            <Dialog>
              <DialogTrigger
                render={
                  <Button variant="outline" size="sm" className="h-7 text-xs px-3">
                    View Uploads
                  </Button>
                }
              />
              <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
                <DialogHeader className="px-6 py-4 border-b">
                  <DialogTitle>
                    Uploaded {mediaType === 'image' ? 'Images' : 'Files'} ({assets.length})
                  </DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {mediaType === 'image' ? (
                    <ImageGallery assets={assets} onDelete={handleDelete} />
                  ) : (
                    <FileList assets={assets} mediaType={mediaType} onDelete={handleDelete} />
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : staged.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-muted-foreground">No {mediaType} files yet</p>
        </div>
      ) : null}

      {/* Storage warning */}
      {storageUsedBytes > 1024 * 1024 * 1024 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
          <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-[12px] font-medium text-amber-800">
              Storage usage: {formatSize(storageUsedBytes)}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-600">
              Media files are stored locally. Cloud storage support coming soon.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Image gallery grid                                                  */
/* ------------------------------------------------------------------ */

function ImageGallery({
  assets,
  onDelete,
}: {
  assets: MediaAsset[];
  onDelete: (id: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(12);
  const [expandedAsset, setExpandedAsset] = useState<MediaAsset | null>(null);

  const visibleAssets = assets.slice(0, visibleCount);
  const hasMore = visibleCount < assets.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {visibleAssets.map((asset) => (
          <div
            key={asset.id}
            onClick={() => setExpandedAsset(asset)}
            className="group relative aspect-[2/1] sm:aspect-[21/9] rounded-xl overflow-hidden bg-muted/30 border border-border/50 cursor-pointer"
          >
            <img
              src={`/api/media/${asset.id}?thumb=true`}
              alt={asset.fileName}
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={(e) => {
                // Fallback to original if no thumbnail
                (e.target as HTMLImageElement).src = `/api/media/${asset.id}`;
              }}
            />

            {/* Processing status overlay */}
            {asset.processingStatus === 'processing' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Loader2 className="size-4 animate-spin text-white" />
              </div>
            )}
            {asset.processingStatus === 'failed' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <AlertCircle className="size-4 text-red-400" />
              </div>
            )}
            {asset.processingStatus === 'pending' && (
              <div className="absolute bottom-2 right-2">
                <Clock className="size-3.5 text-white/80 " />
              </div>
            )}

            {/* Hover actions */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(asset.id);
                }}
                className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto hover:bg-black/70"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2 pb-6">
          <Button
            variant="outline"
            onClick={() => setVisibleCount((prev) => prev + 12)}
            className="text-muted-foreground"
          >
            Load More
          </Button>
        </div>
      )}

      {/* Lightbox Overlay */}
      {expandedAsset && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-8 animate-in fade-in duration-200"
          onClick={() => setExpandedAsset(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img
              src={`/api/media/${expandedAsset.id}`}
              alt={expandedAsset.fileName}
              className="max-w-full max-h-[90vh] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()} // Prevent click from closing immediately
            />
            <button
              onClick={() => setExpandedAsset(null)}
              className="absolute -top-3 -right-3 md:-top-5 md:-right-5 rounded-full bg-black/50 border border-white/20 p-2 text-white hover:bg-black/80 transition-colors"
            >
              <X className="size-5" />
            </button>
            <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent text-white rounded-b-lg opacity-0 hover:opacity-100 transition-opacity flex justify-between items-end">
              <div>
                <p className="text-sm font-medium">{expandedAsset.fileName}</p>
                <p className="text-xs text-white/70 mt-1">{formatSize(expandedAsset.fileSize)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Video/Audio file list                                               */
/* ------------------------------------------------------------------ */

function FileList({
  assets,
  mediaType,
  onDelete,
}: {
  assets: MediaAsset[];
  mediaType: 'video' | 'audio';
  onDelete: (id: string) => void;
}) {
  const Icon = mediaType === 'video' ? Video : AudioLines;

  return (
    <div className="flex flex-col gap-1.5">
      {assets.map((asset) => (
        <div
          key={asset.id}
          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 group"
        >
          <div className="flex size-9 items-center justify-center rounded-md bg-muted shrink-0">
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-foreground">{asset.fileName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground">
                {formatSize(asset.fileSize)}
              </span>
              {asset.durationSecs ? (
                <span className="text-[10px] text-muted-foreground">
                  · {Math.floor(asset.durationSecs / 60)}:
                  {String(Math.floor(asset.durationSecs % 60)).padStart(2, '0')}
                </span>
              ) : null}
              <StatusBadge status={asset.processingStatus} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(asset.id)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-destructive transition-all"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'pending' | 'processing' | 'completed' | 'failed' }) {
  if (status === 'completed') {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-emerald-600">
        <Check className="size-2.5" />
        Indexed
      </span>
    );
  }
  if (status === 'processing') {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-blue-600 animate-pulse">
        <Loader2 className="size-2.5 animate-spin" />
        Processing
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-red-500">
        <AlertCircle className="size-2.5" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
      <Clock className="size-2.5" />
      Pending
    </span>
  );
}
