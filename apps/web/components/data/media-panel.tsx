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
  Link2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  processingMessage?: string;
  processingProgress?: number;
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
  durationSecs?: number;
}

interface RemoteEstimate {
  originalUrl: string;
  title?: string;
  durationSecs?: number;
  entryCount?: number;
  mediaType: 'video' | 'audio' | 'unknown';
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

function estimateMedia(durationSecs: number, isVideo: boolean) {
  const minutes = durationSecs / 60;
  return {
    transcriptionCost: minutes * 0.006,
    processingMinutes: Math.max(1, Math.ceil(minutes * (isVideo ? 0.35 : 0.2))),
    visualScenes: isVideo ? Math.min(600, Math.max(1, Math.ceil(durationSecs / 60))) : 0,
  };
}

function readMediaDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(element.duration) ? element.duration : undefined);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    element.src = url;
  });
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

function isActiveJob(asset: MediaAsset): boolean {
  return (
    asset.processingStatus === 'processing' ||
    (asset.processingStatus === 'pending' && Boolean(asset.processingMessage))
  );
}

const INDEXING_PROGRESS_CLASS =
  '[&_[data-slot=progress-indicator]]:bg-emerald-500 dark:[&_[data-slot=progress-indicator]]:bg-emerald-400';

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function MediaPanel({ onAdded }: { onAdded: () => void }) {
  const [activeTab, setActiveTab] = useState<MediaSubTab>('images');
  const mediaType = TAB_TO_TYPE[activeTab];

  const { data, mutate, isLoading } = useSWR(`/api/media?type=${mediaType}`, fetcher);

  useEffect(() => {
    const stream = new EventSource(`/api/media/stream?type=${mediaType}`);
    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const nextData = JSON.parse(event.data) as MediaApiResponse;
        void mutate(nextData, { revalidate: false });
      } catch {
        // Ignore a malformed update and keep the last successful snapshot.
      }
    };

    stream.addEventListener('media-update', handleUpdate);
    return () => {
      stream.removeEventListener('media-update', handleUpdate);
      stream.close();
    };
  }, [mediaType, mutate]);

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
  onMutate: () => void | Promise<unknown>;
  onUploadComplete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [staged, setStagedState] = useState<StagedMedia[]>(globalStagedMedia[mediaType] || []);

  useEffect(() => {
    setStagedState(globalStagedMedia[mediaType] || []);
    setUrlsText('');
    setRemoteEstimates(null);
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
  const [urlsText, setUrlsText] = useState('');
  const [remoteEstimates, setRemoteEstimates] = useState<RemoteEstimate[] | null>(null);
  const [checkingUrls, setCheckingUrls] = useState(false);
  const [importingUrls, setImportingUrls] = useState(false);
  const [importMode, setImportMode] = useState<'upload' | 'url'>('upload');

  const accept = SUB_TABS.find((t) => t.id === tab)?.accept ?? '*/*';

  async function handleFiles(files: FileList | File[]) {
    const inspected = await Promise.all(
      Array.from(files).map(async (file): Promise<StagedMedia | null> => {
        const type = getMediaType(file);
        if (type !== mediaType) {
          toast.error(`${file.name} is not a${mediaType === 'audio' ? 'n' : ''} ${mediaType} file`);
          return null;
        }
        const id = Math.random().toString(36).slice(2);
        const preview = type === 'image' ? URL.createObjectURL(file) : undefined;
        const durationSecs = type === 'image' ? undefined : await readMediaDuration(file);
        return { id, file, type, preview, durationSecs };
      }),
    );
    const newFiles = inspected.filter((item): item is StagedMedia => item !== null);
    if (newFiles.length > 0) setStaged((prev) => [...prev, ...newFiles]);
  }

  function removeFile(id: string) {
    setStaged((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  }

  function showErrorToast(err: unknown) {
    const msg = formatErrorMessage(err);
    if (
      msg.toLowerCase().includes('api key') ||
      msg.toLowerCase().includes('configuration') ||
      msg.toLowerCase().includes('missing provider')
    ) {
      toast.error(msg, {
        duration: 10000,
        action: {
          label: 'Go to Settings',
          onClick: () => router.push('/settings?section=tool-settings'),
        },
      });
    } else {
      toast.error(msg);
    }
  }

  async function processAssets(assetIds: string[]) {
    const PROCESS_BATCH_SIZE = 4;
    for (let i = 0; i < assetIds.length; i += PROCESS_BATCH_SIZE) {
      const batch = assetIds.slice(i, i + PROCESS_BATCH_SIZE);
      const res = await fetch('/api/media/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: batch }),
      });

      if (!res.ok) {
        let err;
        try {
          err = await res.json();
        } catch {
          err = { error: 'Media processing failed' };
        }
        throw new Error(err.error ?? 'Media processing failed');
      }
    }
    await onMutate();
  }

  function parsedUrls() {
    return urlsText
      .split(/[\n,]/)
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  async function reviewRemoteEstimate() {
    const urls = parsedUrls();
    if (urls.length === 0) return;
    setCheckingUrls(true);
    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, estimateOnly: true, mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not inspect media URLs');
      setRemoteEstimates(data.estimates);
    } catch (err) {
      showErrorToast(err);
    } finally {
      setCheckingUrls(false);
    }
  }

  async function importRemoteUrls() {
    const urls = parsedUrls();
    if (urls.length === 0 || !remoteEstimates) return;
    setImportingUrls(true);
    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Media import failed');
      const ids = (data.assets as MediaAsset[]).map((asset) => asset.id);
      await processAssets(ids);
      toast.success(`${mediaType === 'video' ? 'Video' : 'Audio'} indexing started`);
      setUrlsText('');
      setRemoteEstimates(null);
      setProgress(null);
      onUploadComplete();
    } catch (err) {
      showErrorToast(err);
      setProgress(null);
    } finally {
      setImportingUrls(false);
    }
  }

  async function uploadAll() {
    if (staged.length === 0) return;
    setUploading(true);

    const BATCH_SIZE = 5;
    let uploaded = 0;
    const uploadedAssetIds: string[] = [];
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

        const responseData = await res.json();
        if (!res.ok) {
          const err = responseData;
          throw new Error(err.error ?? 'Upload failed');
        }
        uploadedAssetIds.push(
          ...(responseData.assets as MediaAsset[]).map((asset: MediaAsset) => asset.id),
        );

        uploaded += batch.length;
        setProgress({ message: 'Uploading files...', current: uploaded, total });
      }

      if (uploadedAssetIds.length > 0) {
        setProgress({ message: 'Queueing files for indexing...', current: 0, total: uploaded });
        await processAssets(uploadedAssetIds);
      }
      const mediaLabel =
        mediaType === 'video' ? 'Video' : mediaType === 'audio' ? 'Audio' : 'Image';
      toast.success(`${mediaLabel} indexing started`);
      setProgress(null);

      staged.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      globalStagedMedia[mediaType] = [];
      setStaged([]);
      setUploading(false);

      onUploadComplete();
    } catch (err) {
      showErrorToast(err);
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

  async function handleRetry(assetId: string) {
    setProgress({ message: 'Retrying media processing...', current: 0, total: 1 });
    try {
      await processAssets([assetId]);
      toast.success(
        `${
          mediaType === 'video' ? 'Video' : mediaType === 'audio' ? 'Audio' : 'Image'
        } indexing started`,
      );
      onMutate();
    } catch (err) {
      showErrorToast(err);
    } finally {
      setProgress(null);
    }
  }

  const stagedDuration = staged.reduce((total, item) => total + (item.durationSecs ?? 0), 0);
  const stagedEstimate = estimateMedia(stagedDuration, mediaType === 'video');
  const remoteDuration =
    remoteEstimates?.reduce((total, estimate) => total + (estimate.durationSecs ?? 0), 0) ?? 0;
  const remoteEstimate = estimateMedia(remoteDuration, mediaType === 'video');
  const activeAssets = assets.filter(isActiveJob);

  return (
    <div className="space-y-4">
      {progress && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{progress.message || `Processing ${progress.current} of ${progress.total}`}</span>
            <span>{Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%</span>
          </div>
          <Progress
            value={(progress.current / Math.max(progress.total, 1)) * 100}
            className="h-1.5"
          />
        </div>
      )}

      {activeAssets.length > 0 ? <ActiveIndexingList assets={activeAssets} /> : null}

      {mediaType !== 'image' && (
        <div className="mt-5 flex items-center gap-4 border-b border-border/40 mb-4 px-2">
          <button
            type="button"
            onClick={() => setImportMode('upload')}
            className={cn(
              'flex items-center gap-1.5 pb-2.5 text-[13px] font-medium border-b-2 transition-colors -mb-px',
              importMode === 'upload'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            <Upload className="size-3.5" />
            Upload File
          </button>
          <button
            type="button"
            onClick={() => setImportMode('url')}
            className={cn(
              'flex items-center gap-1.5 pb-2.5 text-[13px] font-medium border-b-2 transition-colors -mb-1px',
              importMode === 'url'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
            )}
          >
            <Link2 className="size-3.5" />
            Import URL
          </button>
        </div>
      )}

      {mediaType !== 'image' && importMode === 'url' ? (
        <div className="w-full">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Import ${mediaType} URL`}
              value={urlsText}
              onChange={(event) => {
                setUrlsText(event.target.value);
                setRemoteEstimates(null);
              }}
              placeholder={
                mediaType === 'video'
                  ? 'https://youtube.com/watch?v=…'
                  : 'https://cdn.example.com/episode.mp3'
              }
              className="bg-background text-xs h-9 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              disabled={checkingUrls || importingUrls || parsedUrls().length === 0}
              onClick={reviewRemoteEstimate}
            >
              {checkingUrls ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <Clock className="mr-1.5 size-3" />
              )}
              Review
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 text-xs"
              disabled={!remoteEstimates || importingUrls}
              onClick={importRemoteUrls}
            >
              {importingUrls ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 size-3" />
              )}
              Import
            </Button>
          </div>
          <p className="mt-2 pl-1 text-[11px] leading-relaxed text-muted-foreground">
            Direct {mediaType} links
            {mediaType === 'video' ? ', YouTube videos, or playlists' : ''}. Add up to 10 URLs
            separated by commas.
          </p>
          {remoteEstimates ? (
            <div className="mt-4 flex flex-col gap-4 border-t border-border/70 pt-4">
              <div className="grid gap-2 sm:grid-cols-3">
                <EstimateMetric
                  label="Media"
                  value={`${remoteEstimates.reduce(
                    (sum: any, item: any) => sum + (item.entryCount ?? 1),
                    0,
                  )} item(s) · ${
                    remoteDuration ? formatDuration(remoteDuration) : 'duration unavailable'
                  }`}
                />
                <EstimateMetric
                  label="Expected time"
                  value={
                    remoteDuration
                      ? `~${remoteEstimate.processingMinutes} min`
                      : 'Calculated during import'
                  }
                />
                <EstimateMetric
                  label="Estimated API cost"
                  value={
                    remoteDuration
                      ? `~$${remoteEstimate.transcriptionCost.toFixed(2)} +`
                      : 'Model-dependent'
                  }
                />
              </div>

              {remoteEstimates
                .filter((est: any) => est.mediaType === 'video')
                .slice(0, 1)
                .map((est: any, i: number) => {
                  let embedUrl = est.originalUrl;
                  if (est.isYouTube) {
                    try {
                      const u = new URL(est.originalUrl);
                      const v = u.hostname.includes('youtu.be')
                        ? u.pathname.slice(1)
                        : u.searchParams.get('v');
                      embedUrl = `https://www.youtube.com/embed/${v}`;
                    } catch (e) {
                      // ignore
                    }
                    return (
                      <div
                        key={i}
                        className="relative w-full overflow-hidden rounded-xl aspect-video shadow-md border border-border/50 ring-1 ring-border/20 bg-black"
                      >
                        <iframe
                          src={embedUrl}
                          className="absolute inset-0 w-full h-full"
                          frameBorder="0"
                          allowFullScreen
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                      </div>
                    );
                  } else {
                    return (
                      <video
                        key={i}
                        src={embedUrl}
                        controls
                        className="w-full max-w-sm rounded-md aspect-video bg-muted object-cover shadow-sm border border-border"
                      />
                    );
                  }
                })}
            </div>
          ) : null}
        </div>
      ) : (
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
      )}

      {/* Staged files */}
      {staged.length > 0 && (
        <div className="space-y-3">
          {mediaType !== 'image' && stagedDuration > 0 ? (
            <div className="grid gap-2 rounded-lg border border-border bg-muted/15 px-3 py-2.5 sm:grid-cols-3">
              <EstimateMetric label="Duration" value={formatDuration(stagedDuration)} />
              <EstimateMetric
                label="Expected time"
                value={`~${stagedEstimate.processingMinutes} min`}
              />
              <EstimateMetric
                label="Estimated API cost"
                value={`~$${stagedEstimate.transcriptionCost.toFixed(2)}${
                  mediaType === 'video'
                    ? ` + up to ${stagedEstimate.visualScenes} vision calls`
                    : ''
                }`}
              />
            </div>
          ) : null}

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
                    className="group relative aspect-4/3 rounded-xl overflow-hidden bg-muted/30 border border-border/50"
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
                  <div className="flex items-center justify-center rounded-xl bg-muted/30 border border-border/50 text-muted-foreground text-sm font-medium aspect-4/3">
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
                    <FileList
                      assets={assets}
                      mediaType={mediaType}
                      onDelete={handleDelete}
                      onProcess={handleRetry}
                    />
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
            className="group relative aspect-2/1 sm:aspect-21/9 rounded-xl overflow-hidden bg-muted/30 border border-border/50 cursor-pointer"
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
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm p-4 text-center">
                <Loader2 className="size-5 animate-spin text-white mb-2" />
                <span className="text-[10px] text-white/90 line-clamp-2 leading-tight">
                  {asset.processingMessage || 'Processing...'}
                </span>
                <Progress
                  value={asset.processingProgress ?? 0}
                  className={cn('mt-2 h-1.5 w-4/5 bg-white/20', INDEXING_PROGRESS_CLASS)}
                />
                <span className="mt-1 text-[9px] tabular-nums text-white/75">
                  {Math.round(asset.processingProgress ?? 0)}%
                </span>
              </div>
            )}
            {asset.processingStatus === 'failed' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm p-4 text-center">
                <AlertCircle className="size-5 text-red-400 mb-2" />
                <span className="text-[10px] text-red-200 line-clamp-2 leading-tight">
                  {asset.processingError || 'Failed'}
                </span>
              </div>
            )}
            {asset.processingStatus === 'pending' && (
              <div className="absolute bottom-2 right-2 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-sm flex items-center gap-1.5 max-w-[80%]">
                <Clock className="size-3 text-white/80 shrink-0" />
                <span className="text-[9px] text-white/90 truncate">
                  {asset.processingMessage || 'Pending...'}
                </span>
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
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-8 animate-in fade-in duration-200"
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
            <div className="absolute bottom-0 inset-x-0 p-4 bg-linear-to-t from-black/80 to-transparent text-white rounded-b-lg opacity-0 hover:opacity-100 transition-opacity flex justify-between items-end">
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
  onProcess,
}: {
  assets: MediaAsset[];
  mediaType: 'video' | 'audio';
  onDelete: (id: string) => void;
  onProcess: (id: string) => void;
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
              <StatusBadge asset={asset} />
            </div>
            {isActiveJob(asset) ? (
              <Progress
                value={asset.processingProgress ?? 1}
                className={cn('mt-2 h-1', INDEXING_PROGRESS_CLASS)}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {asset.processingStatus === 'failed' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onProcess(asset.id)}
              >
                Retry
              </Button>
            ) : null}
            <button
              type="button"
              aria-label={`Delete ${asset.fileName}`}
              onClick={() => onDelete(asset.id)}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-muted-foreground hover:text-destructive transition-all"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status badge                                                        */
/* ------------------------------------------------------------------ */

function StatusBadge({ asset }: { asset: MediaAsset }) {
  const status = asset.processingStatus;

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
      <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50/50 px-1.5 py-0.5 rounded-sm">
        <Loader2 className="size-2.5 animate-spin shrink-0" />
        <span
          className="truncate max-w-[120px] sm:max-w-[200px]"
          title={asset.processingMessage || 'Processing...'}
        >
          {asset.processingMessage || 'Processing...'}
        </span>
        <span className="tabular-nums">{Math.round(asset.processingProgress ?? 0)}%</span>
      </span>
    );
  }
  if (status === 'pending' && asset.processingMessage) {
    return (
      <span className="flex items-center gap-1 rounded-sm bg-blue-50/50 px-1.5 py-0.5 text-[10px] text-blue-600">
        <Loader2 className="size-2.5 shrink-0 animate-spin" />
        <span className="max-w-[120px] truncate sm:max-w-[200px]" title={asset.processingMessage}>
          {asset.processingMessage}
        </span>
        <span className="tabular-nums">{Math.round(asset.processingProgress ?? 1)}%</span>
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="flex items-center gap-0.5 text-[10px] text-red-500"
        title={asset.processingError}
      >
        <AlertCircle className="size-2.5 shrink-0" />
        <span className="truncate max-w-[120px]">{asset.processingError || 'Failed'}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
      <Clock className="size-2.5 shrink-0" />
      <span className="truncate max-w-[120px]" title={asset.processingMessage || 'Pending...'}>
        {asset.processingMessage || 'Pending...'}
      </span>
    </span>
  );
}

function ActiveIndexingList({ assets }: { assets: MediaAsset[] }) {
  return (
    <section
      aria-live="polite"
      aria-label="Active media indexing jobs"
      className="space-y-3 rounded-xl border border-emerald-200/70 bg-emerald-50/35 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/20"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground">
            Indexing {assets.length} {assets.length === 1 ? 'file' : 'files'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Live updates as each indexing stage finishes
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {assets.map((asset) => {
          const progress = Math.max(1, Math.min(100, asset.processingProgress ?? 1));
          return (
            <div
              key={asset.id}
              className="space-y-1.5 rounded-lg border border-border/70 bg-background/80 p-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-foreground">
                    {asset.fileName}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {asset.processingMessage || 'Preparing media indexing...'}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress
                value={progress}
                className={cn(
                  'h-1.5 **:data-[slot=progress-indicator]:transition-[transform] **:data-[slot=progress-indicator]:duration-500 **:data-[slot=progress-indicator]:ease-out',
                  INDEXING_PROGRESS_CLASS,
                )}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EstimateMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}:${String(secs).padStart(2, '0')}`;
}
