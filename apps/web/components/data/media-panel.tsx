'use client';

import { useRef, useState, useEffect } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/error-formatter';
import {
  describeActiveMediaStep,
  mediaStepProgress,
  primaryRunningMediaStep,
} from '@/lib/media-progress';
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
  Pause,
  Play,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DataPrimaryAction } from '@/components/data/data-primary-action';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type MediaSubTab = 'images' | 'video' | 'audio';
type MediaEntryTab = 'upload' | 'url';
type MediaPipelineStage = 'download' | 'extract' | 'transcribe' | 'vision' | 'synthesize' | 'index';

interface MediaProcessingStep {
  stage: MediaPipelineStage;
  status: 'waiting' | 'running' | 'completed' | 'skipped' | 'failed';
  percent?: number;
  current?: number;
  total?: number;
  unit?: string;
  message?: string;
}

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
  processingPaused?: boolean;
  processingProgress?: number;
  processingSteps?: MediaProcessingStep[];
  processingRevision?: number;
  caption?: string;
  documentIds: string[];
  createdAt: string;
  dimensions?: { width: number; height: number };
  durationSecs?: number;
  indexingInstructions?: string;
  indexingQuality?: number;
  activeVideoKnowledgeRevisionId?: string;
  activeVideoKnowledgeManifestId?: string;
  activeVideoKnowledgeJobId?: string;
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

function mediaAssetUrl(assetId: string, serverId?: string, thumbnail = false): string {
  const query = new URLSearchParams();
  if (thumbnail) query.set('thumb', 'true');
  if (serverId) query.set('serverId', serverId);
  const suffix = query.toString();
  return `/api/media/${assetId}${suffix ? `?${suffix}` : ''}`;
}

function getMediaType(file: File): 'image' | 'video' | 'audio' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

function estimateMedia(durationSecs: number, isVideo: boolean) {
  const minutes = durationSecs / 60;
  const visualWindowSecs =
    durationSecs >= 4 * 60 * 60 ? 15 * 60 : durationSecs > 60 * 60 ? 5 * 60 : 60;
  return {
    transcriptionCost: minutes * 0.006,
    processingMinutes: Math.max(1, Math.ceil(minutes * (isVideo ? 0.35 : 0.2))),
    visualScenes: isVideo ? Math.max(1, Math.ceil(durationSecs / visualWindowSecs)) : 0,
  };
}

function qualityFrameEstimate(quality: number, durationSecs: number): number {
  const intervalMap: Record<number, number> = { 20: 60, 40: 45, 60: 30, 80: 18, 100: 12 };
  const maxMap: Record<number, number> = { 20: 100, 40: 250, 60: 600, 80: 900, 100: 1200 };
  const tier =
    quality <= 20 ? 20 : quality <= 40 ? 40 : quality <= 60 ? 60 : quality <= 80 ? 80 : 100;
  const interval = intervalMap[tier];
  const max = maxMap[tier];
  return Math.min(max, Math.max(1, Math.ceil(durationSecs / interval)));
}

function qualityVisionCalls(quality: number, durationSecs: number): number {
  const frames = qualityFrameEstimate(quality, durationSecs);
  // Backend groups by 12 frames per vision API call
  return Math.max(1, Math.ceil(frames / 12));
}

function qualityCostEstimate(quality: number, durationSecs: number): string {
  const calls = qualityVisionCalls(quality, durationSecs);
  // Transcription buffer (e.g. $0.008/min instead of $0.006)
  const transcriptionCost = (durationSecs / 60) * 0.008;
  // Vision buffer (e.g. $0.007/call instead of $0.003 to cover more expensive models)
  const visionCost = calls * 0.007;
  return (transcriptionCost + visionCost).toFixed(2);
}

function readMediaDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    // Some browsers never emit metadata or error events for incomplete media.
    // Staging must stay responsive even when the eventual upload is rejected.
    const timeout = window.setTimeout(() => finish(undefined), 3_000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      finish(Number.isFinite(element.duration) ? element.duration : undefined);
    };
    element.onerror = () => {
      finish(undefined);
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

export function MediaPanel({
  onAdded,
  onIndexed,
  onActionChange,
}: {
  onAdded: () => void;
  onIndexed: (asset: MediaAsset) => void;
  onActionChange?: (action: DataPrimaryAction | null) => void;
}) {
  const [activeTab, setActiveTab] = useState<MediaSubTab>('images');
  const [entryTab, setEntryTab] = useState<MediaEntryTab>('upload');
  const mediaType = TAB_TO_TYPE[activeTab];
  const previousStatusesRef = useRef<Map<string, MediaAsset['processingStatus']> | null>(null);
  const { activeServer } = useWorkspace();
  const serverId = activeServer?.id;
  const serverQuery = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  const router = useRouter();

  const { data, mutate, isLoading } = useSWR(`/api/media?type=all${serverQuery}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  useEffect(() => {
    previousStatusesRef.current = null;
    const stream = new EventSource(`/api/media/stream?type=all${serverQuery}`);
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    const handleUpdate = (event: MessageEvent<string>) => {
      try {
        const nextData = JSON.parse(event.data) as MediaApiResponse;
        const previousStatuses = previousStatusesRef.current;
        const nextStatuses = new Map(
          nextData.assets.map((asset) => [asset.id, asset.processingStatus]),
        );

        // The first SSE snapshot establishes the baseline. Subsequent updates
        // let us react only to a job that just finished, not old completed media.
        if (previousStatuses) {
          for (const asset of nextData.assets) {
            const previousStatus = previousStatuses.get(asset.id);
            if (
              asset.processingStatus === 'completed' &&
              (previousStatus === 'pending' || previousStatus === 'processing')
            ) {
              onIndexed(asset);
              try {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                gain.gain.setValueAtTime(0.05, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.1);
              } catch (e) {
                // Ignore audio context errors
              }
            }
            if (
              asset.processingStatus === 'failed' &&
              (previousStatus === 'pending' || previousStatus === 'processing')
            ) {
              const msg =
                asset.processingError ||
                asset.processingMessage ||
                `Failed to index ${asset.fileName}`;
              if (
                msg.toLowerCase().includes('api key') ||
                msg.toLowerCase().includes('configuration') ||
                msg.toLowerCase().includes('missing provider') ||
                msg.toLowerCase().includes('choose an audio provider')
              ) {
                toast.error(`Indexing failed: ${asset.fileName}`, {
                  description: msg,
                  duration: 10000,
                  action: {
                    label: 'Go to Settings',
                    onClick: () => router.push('/settings?section=tool-settings'),
                  },
                });
              } else {
                toast.error(`Indexing failed: ${asset.fileName}`, {
                  description: msg,
                  duration: 8000,
                });
              }
            }
          }
        }
        previousStatusesRef.current = nextStatuses;
        void mutate(nextData, { revalidate: false });
      } catch {
        // Ignore a malformed update and keep the last successful snapshot.
      }
    };

    stream.onopen = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    stream.onerror = () => {
      void mutate();
      fallbackTimer ??= setInterval(() => void mutate(), 5_000);
    };

    // Removed manual visibilitychange mutate to prevent SWR cache invalidation
    // The EventSource automatically reconnects and synchronizes state natively.

    stream.addEventListener('media-update', handleUpdate);
    return () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      stream.removeEventListener('media-update', handleUpdate);
      stream.close();
    };
  }, [mediaType, mutate, onIndexed, serverQuery]);

  const { data: toolsData, mutate: mutateTools } = useSWR('/api/marketplace', toolFetcher);

  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : '/api/config';
  const { data: configData } = useSWR(configUrl, (url) => fetch(url).then((r) => r.json()));

  // Check if the Video Intelligence tool is installed and enabled.
  const videoAudioTool = toolsData?.tools?.find((t: any) => t.id === 'video-audio');
  const isToolInstalled = videoAudioTool?.status === 'installed';
  const enabledTools = configData?.config?.enabledTools;
  const videoAudioConfig = configData?.config?.toolConfigs?.['video-audio'] ?? {};
  const audioProvider =
    typeof videoAudioConfig.audioProvider === 'string' ? videoAudioConfig.audioProvider : '';
  const audioApiKey =
    typeof videoAudioConfig.audioApiKey === 'string' ? videoAudioConfig.audioApiKey : '';
  const audioConfigured = Boolean(audioProvider && (audioProvider === 'local' || audioApiKey));
  const isToolEnabled = enabledTools
    ? enabledTools.length === 0 || enabledTools.includes('video-audio')
    : true;

  const needsTool = false;
  const isToolDisabled = activeTab !== 'images' && isToolInstalled && !isToolEnabled;

  const assets = data?.assets ?? [];
  const storageBytes = data?.storage?.usedBytes ?? 0;

  return (
    <div className="space-y-5">
      {/* Keep the task choice small. File type is detected after selection. */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-1 border border-border/90 rounded-lg bg-muted/60 p-1">
          {[
            { id: 'upload' as const, label: 'Upload', icon: Upload },
            { id: 'url' as const, label: 'From URL', icon: Link2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = entryTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEntryTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium transition-all duration-200 rounded-md',
                  isActive
                    ? 'bg-background text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                )}
              >
                <Icon className="size-3.5" strokeWidth={isActive ? 2 : 1.75} />
                {tab.label}
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
          toolName={videoAudioTool?.name ?? 'Video Intelligence'}
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
          serverId={serverId}
          onMutate={() => mutate()}
          onUploadComplete={() => {
            mutate();
            onAdded();
          }}
          audioConfigured={audioConfigured}
          onConfigureAudio={() => router.push('/settings?section=tool-settings')}
          entryTab={entryTab}
          onMediaTypeDetected={(type) => setActiveTab(type === 'image' ? 'images' : type)}
          videoAudioToolInstalled={isToolInstalled}
          onToolRequired={() => {
            toast.error('Video Intelligence tool required', {
              description: 'Install it to add video or audio.',
              action: {
                label: 'Install',
                onClick: async () => {
                  const toastId = toast.loading('Installing video tool…');
                  try {
                    const res = await fetch('/api/marketplace/video-audio', { method: 'POST' });
                    const body = await res.json();
                    if (!res.ok) throw new Error(body.error || 'Install failed');
                    toast.success('Video tool installed', { id: toastId });
                    void mutateTools();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Install failed', {
                      id: toastId,
                    });
                  }
                },
              },
            });
          }}
          onActionChange={onActionChange}
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
    const toastId = toast.loading('Downloading and installing tool…', {
      description: 'This may take a moment on first install.',
    });
    try {
      const res = await fetch(`/api/marketplace/${toolId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Install failed');
      }
      toast.dismiss(toastId);
      toast.success('Video Intelligence installed', {
        description: 'Choose an audio provider before indexing video or audio.',
        action: {
          label: 'Set up audio',
          onClick: () => window.location.assign('/settings?section=tool-settings'),
        },
      });
      onInstallComplete();
    } catch (err) {
      toast.dismiss(toastId);
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
        Video Intelligence Processing Disabled
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        The Video Intelligence tool is currently disabled in your agent settings. You cannot index
        new video or audio files until it is re-enabled.
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
  serverId,
  onMutate,
  onUploadComplete,
  audioConfigured,
  onConfigureAudio,
  entryTab,
  onMediaTypeDetected,
  videoAudioToolInstalled,
  onToolRequired,
  onActionChange,
}: {
  mediaType: 'image' | 'video' | 'audio';
  tab: MediaSubTab;
  assets: MediaAsset[];
  isLoading: boolean;
  storageUsedBytes: number;
  serverId?: string;
  onMutate: () => void | Promise<unknown>;
  onUploadComplete: () => void;
  audioConfigured: boolean;
  onConfigureAudio: () => void;
  entryTab: MediaEntryTab;
  onMediaTypeDetected: (type: 'image' | 'video' | 'audio') => void;
  videoAudioToolInstalled: boolean;
  onToolRequired: () => void;
  onActionChange?: (action: DataPrimaryAction | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [libraryTab, setLibraryTab] = useState<MediaSubTab>('images');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryPage, setLibraryPage] = useState(0);
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
  const [urlsText, setUrlsText] = useState('');
  const [remoteEstimates, setRemoteEstimates] = useState<RemoteEstimate[] | null>(null);
  const [remoteType, setRemoteType] = useState<'image' | 'video' | 'audio'>(mediaType);
  const [checkingUrls, setCheckingUrls] = useState(false);
  const [importingUrls, setImportingUrls] = useState(false);
  const [playlistAlertOpen, setPlaylistAlertOpen] = useState(false);
  const [assetToRemove, setAssetToRemove] = useState<MediaAsset | null>(null);
  const [indexingInstructions, setIndexingInstructions] = useState('');
  const [indexingQuality, setIndexingQuality] = useState(50);
  const mediaApiUrl = serverId
    ? `/api/media?serverId=${encodeURIComponent(serverId)}`
    : '/api/media';

  const accept = 'image/*,video/*,audio/*';

  async function handleFiles(files: FileList | File[]) {
    const detectedType = getMediaType(Array.from(files)[0]);
    if (!detectedType) {
      toast.error('Choose an image, video, or audio file.');
      return;
    }
    const inspected = await Promise.all(
      Array.from(files)
        .filter((file) => getMediaType(file) === detectedType)
        .map(async (file): Promise<StagedMedia | null> => {
          const type = getMediaType(file);
          if (!type) return null;
          const id = Math.random().toString(36).slice(2);
          const preview =
            type === 'image' || type === 'audio' ? URL.createObjectURL(file) : undefined;
          const durationSecs = type === 'image' ? undefined : await readMediaDuration(file);
          return { id, file, type, preview, durationSecs };
        }),
    );
    const newFiles = inspected.filter((item): item is StagedMedia => item !== null);
    if (newFiles.length > 0) {
      if (detectedType === mediaType) {
        setStaged((prev) => [...prev, ...newFiles]);
      } else {
        globalStagedMedia[detectedType] = [...(globalStagedMedia[detectedType] || []), ...newFiles];
        onMediaTypeDetected(detectedType);
      }
    }
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
    const normalizedMessage = msg.toLowerCase();
    if (
      normalizedMessage.includes('video & audio tool needs an update') ||
      normalizedMessage.includes('video & audio tool not properly installed') ||
      normalizedMessage.includes('yt-dlp is required for youtube urls')
    ) {
      toast.error('Update Video Intelligence to continue.', {
        description:
          'Your installed tool is out of date. Update it, then try adding the media again.',
        duration: 10_000,
        action: {
          label: 'Update tool',
          onClick: () => void updateVideoAudioTool(),
        },
      });
      return;
    }
    if (
      normalizedMessage.includes('api key') ||
      normalizedMessage.includes('configuration') ||
      normalizedMessage.includes('missing provider') ||
      normalizedMessage.includes('choose an audio provider')
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

  async function updateVideoAudioTool() {
    const toastId = toast.loading('Updating Video Intelligence…');
    try {
      const response = await fetch('/api/marketplace/video-audio?force=true', { method: 'POST' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || 'Could not update Video Intelligence.');
      toast.success('Video Intelligence updated', {
        id: toastId,
        description: 'Try adding the media again.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update Video Intelligence.', {
        id: toastId,
      });
    }
  }

  function ensureAudioConfiguration(type = mediaType): boolean {
    if (type === 'image') return true;
    if (!videoAudioToolInstalled) {
      onToolRequired();
      return false;
    }
    if (audioConfigured) return true;
    toast.error('Set up an audio provider to index video or audio.', {
      description: 'Select a provider and add its API key in Installed Tools.',
      duration: 10_000,
      action: { label: 'Set up audio', onClick: onConfigureAudio },
    });
    return false;
  }

  async function processAssets(assetIds: string[]) {
    const PROCESS_BATCH_SIZE = 4;
    for (let i = 0; i < assetIds.length; i += PROCESS_BATCH_SIZE) {
      const batch = assetIds.slice(i, i + PROCESS_BATCH_SIZE);
      const res = await fetch('/api/media/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: batch, serverId }),
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

  function mediaTypeFromUrl(url: string): 'image' | 'video' | 'audio' {
    const path = url.split('?')[0].toLowerCase();
    if (/\.(png|jpe?g|webp|gif|svg|avif)$/.test(path)) return 'image';
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(path)) return 'audio';
    return 'video';
  }

  async function reviewRemoteEstimate() {
    const urls = parsedUrls();
    if (urls.length === 0) return;
    const type = mediaTypeFromUrl(urls[0]);
    setRemoteType(type);
    onMediaTypeDetected(type);
    if (!ensureAudioConfiguration(type)) return;
    setCheckingUrls(true);
    try {
      if (type === 'image') {
        setRemoteEstimates(urls.map((originalUrl) => ({ originalUrl, mediaType: 'unknown' })));
        return;
      }
      const res = await fetch(mediaApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, estimateOnly: true, mediaType: type }),
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

  async function importRemoteUrls(ignorePlaylist = false) {
    let urls = parsedUrls();
    if (urls.length === 0 || !remoteEstimates) return;
    if (!ensureAudioConfiguration(remoteType)) return;

    if (ignorePlaylist) {
      urls = urls.map((url) => {
        try {
          const u = new URL(url);
          if (u.hostname.includes('youtube.com')) {
            u.searchParams.delete('list');
            return u.toString();
          }
        } catch {}
        return url;
      });
    }

    setImportingUrls(true);
    try {
      const res = await fetch(mediaApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, mediaType: remoteType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Media import failed');
      const ids = (data.assets as MediaAsset[]).map((asset) => asset.id);
      toast.success('Media import started', {
        description: 'Queued for download and indexing. You can safely leave in the meantime.',
        duration: 8_000,
      });
      await processAssets(ids);
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
    if (!ensureAudioConfiguration()) return;
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
        if (indexingInstructions.trim()) {
          formData.append('indexingInstructions', indexingInstructions.trim());
        }
        formData.append('indexingQuality', String(indexingQuality));

        const res = await fetch(mediaApiUrl, {
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
      toast.success(`${mediaLabel} indexing started`, {
        description:
          mediaType === 'image'
            ? 'You can safely leave while we make it searchable.'
            : `Expected time: about ${stagedEstimate.processingMinutes} minute${
                stagedEstimate.processingMinutes === 1 ? '' : 's'
              }. You can safely leave while we index it.`,
        duration: 8_000,
      });
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
      const query = new URLSearchParams({ id: assetId, force: 'true' });
      if (serverId) query.set('serverId', serverId);
      const response = await fetch(`/api/media?${query.toString()}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to delete media.');
      }
      toast.success('File removed');
      onMutate();
    } catch (error) {
      showErrorToast(error);
    }
  }

  async function togglePause(asset: MediaAsset) {
    try {
      const res = await fetch('/api/media/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: asset.processingPaused ? 'resume' : 'pause',
          assetId: asset.id,
          serverId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not update media indexing.');
      toast.success(asset.processingPaused ? 'Media indexing resumed.' : 'Media indexing paused.');
      await onMutate();
    } catch (error) {
      showErrorToast(error);
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
  const libraryPageSize = 12;
  const libraryAssets = assets.filter((asset) => {
    const matchesType = asset.type === TAB_TO_TYPE[libraryTab];
    const matchesSearch = asset.fileName.toLowerCase().includes(librarySearch.trim().toLowerCase());
    return matchesType && matchesSearch;
  });
  const libraryTotalPages = Math.max(1, Math.ceil(libraryAssets.length / libraryPageSize));
  const safeLibraryPage = Math.min(libraryPage, libraryTotalPages - 1);
  const paginatedLibraryAssets = libraryAssets.slice(
    safeLibraryPage * libraryPageSize,
    (safeLibraryPage + 1) * libraryPageSize,
  );
  const libraryStart = libraryAssets.length === 0 ? 0 : safeLibraryPage * libraryPageSize + 1;
  const libraryEnd = Math.min((safeLibraryPage + 1) * libraryPageSize, libraryAssets.length);
  const hasUrls = parsedUrls().length > 0;

  function submitUrlMedia() {
    const totalEntries =
      remoteEstimates?.reduce((sum: number, item: any) => sum + (item.entryCount ?? 1), 0) ?? 0;
    if (totalEntries > 1) {
      setPlaylistAlertOpen(true);
    } else {
      void importRemoteUrls();
    }
  }

  useEffect(() => {
    const fromUrl = entryTab === 'url';
    onActionChange?.({
      label: fromUrl ? (remoteEstimates ? 'Add media' : 'Check URL') : 'Add media',
      onClick: () => {
        if (fromUrl) {
          if (remoteEstimates) submitUrlMedia();
          else void reviewRemoteEstimate();
        } else {
          void uploadAll();
        }
      },
      disabled: fromUrl ? !hasUrls : staged.length === 0,
      loading: fromUrl ? checkingUrls || importingUrls : uploading,
    });
    return () => onActionChange?.(null);
  }, [
    entryTab,
    remoteEstimates,
    hasUrls,
    urlsText,
    checkingUrls,
    importingUrls,
    staged,
    uploading,
    remoteType,
    indexingInstructions,
    indexingQuality,
    onActionChange,
  ]);

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

      {activeAssets.length > 0 ? (
        <ActiveIndexingList
          assets={activeAssets}
          onPause={togglePause}
          onRemove={setAssetToRemove}
        />
      ) : null}

      {entryTab === 'url' ? (
        <div className="w-full">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Import media URL"
              value={urlsText}
              onChange={(event) => {
                setUrlsText(event.target.value);
                setRemoteEstimates(null);
              }}
              placeholder="Paste an image, video, or audio URL"
              className="bg-background text-xs h-9 flex-1"
            />
            {!onActionChange && (
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
            )}
            {!onActionChange && (
              <Button
                type="button"
                size="sm"
                className="h-9 text-xs"
                disabled={!remoteEstimates || importingUrls}
                onClick={() => {
                  const totalEntries =
                    remoteEstimates?.reduce(
                      (sum: number, item: any) => sum + (item.entryCount ?? 1),
                      0,
                    ) ?? 0;
                  if (totalEntries > 1) {
                    setPlaylistAlertOpen(true);
                  } else {
                    importRemoteUrls();
                  }
                }}
              >
                {importingUrls ? (
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 size-3" />
                )}
                Import
              </Button>
            )}
          </div>

          <AlertDialog open={playlistAlertOpen} onOpenChange={setPlaylistAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Playlist Detected</AlertDialogTitle>
                <AlertDialogDescription>
                  You entered a URL that points to a playlist. Do you want to download and index the
                  entire playlist, or just the single video?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPlaylistAlertOpen(false);
                    importRemoteUrls(true);
                  }}
                >
                  Single Video
                </Button>
                <AlertDialogAction
                  onClick={() => {
                    setPlaylistAlertOpen(false);
                    importRemoteUrls(false);
                  }}
                >
                  Entire Playlist
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className="mt-2 pl-1 text-[11px] leading-relaxed text-muted-foreground">
            Direct media links, YouTube videos, or playlists. Add up to 10 URLs separated by commas.
          </p>
          {remoteEstimates
            ? (() => {
                const totalEntries = remoteEstimates.reduce(
                  (sum: number, item: any) => sum + (item.entryCount ?? 1),
                  0,
                );
                const isPlaylist = totalEntries > 1;
                return (
                  <div className="mt-4 flex flex-col gap-4 border-t border-border/70 pt-4">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <EstimateMetric
                        label="Media"
                        value={`${totalEntries} item(s) · ${
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

                    {/* Playlist warning moved to AlertDialog */}

                    {(mediaType === 'audio'
                      ? remoteEstimates.slice(0, 1)
                      : remoteEstimates.filter((est: any) => est.mediaType === 'video').slice(0, 1)
                    ).map((est: any, i: number) => {
                      if (mediaType === 'audio') {
                        return (
                          <div
                            key={i}
                            className="rounded-xl border border-border/70 bg-muted/20 p-3"
                          >
                            <p className="mb-2 truncate text-[11px] font-medium text-foreground">
                              Preview before importing
                            </p>
                            <audio
                              controls
                              preload="metadata"
                              src={est.originalUrl}
                              className="h-9 w-full"
                            />
                          </div>
                        );
                      }
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
                            className="relative w-full overflow-hidden rounded-xl aspect-video 35 border border-border/50 ring-1 ring-border/20 bg-black"
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
                            className="w-full max-w-sm rounded-md aspect-video bg-muted object-cover 35 border border-border"
                          />
                        );
                      }
                    })}
                  </div>
                );
              })()
            : null}
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
              Drop media files here or click to browse
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Images, Video, Audio</p>
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

          {mediaType !== 'image' && staged.length > 0 ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/10 px-3 py-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Focus Instructions
                </label>
                <Textarea
                  value={indexingInstructions}
                  onChange={(e) => setIndexingInstructions(e.target.value)}
                  placeholder="e.g. Track the score between Team A and Team B, focus on goal moments and final result..."
                  className="bg-background text-xs min-h-16 max-h-24 resize-none"
                  rows={2}
                />
                <p className="text-[10px] text-muted-foreground/60">
                  Tell the AI what to focus on while watching. This guides frame analysis and
                  improves answer accuracy.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Indexing Depth
                  </label>
                  <span className="text-[10px] font-medium tabular-nums text-foreground">
                    {indexingQuality <= 20
                      ? 'Quick Scan'
                      : indexingQuality <= 40
                      ? 'Standard'
                      : indexingQuality <= 60
                      ? 'Balanced'
                      : indexingQuality <= 80
                      ? 'Deep'
                      : 'Maximum'}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={indexingQuality}
                  onChange={(e) => setIndexingQuality(Number(e.target.value))}
                  className="w-full h-1.5 accent-primary cursor-pointer"
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
                  <span>Faster · Cheaper</span>
                  <span>Slower · More Accurate</span>
                </div>
                {stagedDuration > 0 ? (
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-0.5">
                    <span>~{qualityFrameEstimate(indexingQuality, stagedDuration)} frames</span>
                    <span>·</span>
                    <span>~{qualityVisionCalls(indexingQuality, stagedDuration)} vision calls</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      ~${qualityCostEstimate(indexingQuality, stagedDuration)}
                    </span>
                  </div>
                ) : null}
              </div>
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
              {!onActionChange && (
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
              )}
            </div>
          </div>

          <div className="max-h-87.5 overflow-y-auto pr-1">
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
                      {mediaType === 'audio' && item.preview ? (
                        <audio
                          aria-label={`Preview ${item.file.name}`}
                          controls
                          preload="metadata"
                          src={item.preview}
                          className="h-8 max-w-44"
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : null}
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
              {assets.length} Uploaded Media
            </h4>
            <Dialog>
              <DialogTrigger
                render={
                  <Button variant="outline" size="sm" className="h-7 text-xs px-3">
                    View Uploads
                  </Button>
                }
              />
              <DialogContent className="h-[calc(100vh-2rem)] max-h-190 w-[calc(100vw-2rem)] sm:max-w-5xl lg:max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 bg-background">
                <DialogHeader className="gap-3 px-5 py-4 sm:px-6">
                  <div>
                    <DialogTitle>Uploaded media</DialogTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Browse, search, and manage every media upload in one place.
                    </p>
                  </div>
                  <div className="relative w-full">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      aria-label="Search uploaded media"
                      value={librarySearch}
                      onChange={(event) => {
                        setLibrarySearch(event.target.value);
                        setLibraryPage(0);
                      }}
                      placeholder="Search uploads"
                      className="h-9 w-full pl-9 text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {SUB_TABS.map((subTab) => {
                      const Icon = subTab.icon;
                      const isActive = libraryTab === subTab.id;
                      const count = assets.filter(
                        (asset) => asset.type === TAB_TO_TYPE[subTab.id],
                      ).length;
                      return (
                        <button
                          key={subTab.id}
                          type="button"
                          onClick={() => {
                            setLibraryTab(subTab.id);
                            setLibraryPage(0);
                          }}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            isActive
                              ? 'bg-muted text-foreground'
                              : 'border border-border bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                        >
                          <Icon className="size-3.5" strokeWidth={isActive ? 2 : 1.75} />
                          {subTab.label}
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </DialogHeader>
                <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
                  {libraryAssets.length === 0 ? (
                    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg  bg-muted/20 px-6 text-center">
                      <Search className="size-4 text-muted-foreground" />
                      <p className="mt-3 text-sm font-medium text-foreground">No uploads found</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {librarySearch
                          ? `No ${SUB_TABS.find(
                              (tab) => tab.id === libraryTab,
                            )?.label.toLowerCase()} match “${librarySearch}”.`
                          : `There are no ${SUB_TABS.find(
                              (tab) => tab.id === libraryTab,
                            )?.label.toLowerCase()} uploads yet.`}
                      </p>
                    </div>
                  ) : libraryTab === 'images' ? (
                    <ImageGallery
                      assets={paginatedLibraryAssets}
                      onDelete={(id) =>
                        setAssetToRemove(assets.find((asset) => asset.id === id) ?? null)
                      }
                      serverId={serverId}
                    />
                  ) : (
                    <FileList
                      assets={paginatedLibraryAssets}
                      mediaType={TAB_TO_TYPE[libraryTab] as 'video' | 'audio'}
                      onDelete={(id) =>
                        setAssetToRemove(assets.find((asset) => asset.id === id) ?? null)
                      }
                      onProcess={handleRetry}
                    />
                  )}
                </div>
                {libraryAssets.length > 0 ? (
                  <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground sm:px-6">
                    <span className="tabular-nums">
                      {libraryStart}–{libraryEnd} of {libraryAssets.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Previous uploads page"
                        disabled={safeLibraryPage === 0}
                        onClick={() => setLibraryPage((page) => Math.max(0, page - 1))}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="min-w-12 text-center tabular-nums">
                        {safeLibraryPage + 1} / {libraryTotalPages}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Next uploads page"
                        disabled={safeLibraryPage >= libraryTotalPages - 1}
                        onClick={() =>
                          setLibraryPage((page) => Math.min(libraryTotalPages - 1, page + 1))
                        }
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : staged.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-muted-foreground">No media files yet</p>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(assetToRemove)}
        onOpenChange={(open) => !open && setAssetToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {assetToRemove?.type ?? 'media'} file?</AlertDialogTitle>
            <AlertDialogDescription>
              {assetToRemove && isActiveJob(assetToRemove)
                ? 'This will stop its indexing job and permanently remove any progress already made.'
                : 'This permanently removes the file and its searchable data from your knowledge base.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep file</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (assetToRemove) void handleDelete(assetToRemove.id);
                setAssetToRemove(null);
              }}
            >
              Remove file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Storage warning */}
      {/* {storageUsedBytes > 1024 * 1024 * 1024 && (
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
      )} */}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Image gallery grid                                                  */
/* ------------------------------------------------------------------ */

function ImageGallery({
  assets,
  onDelete,
  serverId,
}: {
  assets: MediaAsset[];
  onDelete: (id: string) => void;
  serverId?: string;
}) {
  const [expandedAsset, setExpandedAsset] = useState<MediaAsset | null>(null);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {assets.map((asset) => (
          <div
            key={asset.id}
            onClick={() => setExpandedAsset(asset)}
            className="group relative aspect-2/1 sm:aspect-21/9 rounded-xl overflow-hidden bg-muted/30 border border-border/50 cursor-pointer"
          >
            <img
              src={mediaAssetUrl(asset.id, serverId, true)}
              alt={asset.fileName}
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).src = mediaAssetUrl(asset.id, serverId);
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
            {asset.processingStatus === 'completed' && asset.activeVideoKnowledgeRevisionId ? (
              <div className="absolute bottom-2 left-2 rounded-sm bg-emerald-600/85 px-2 py-1 text-[9px] text-white">
                Evidence revision active
              </div>
            ) : null}

            {/* Hover actions */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none">
              {!isActiveJob(asset) ? (
                <button
                  type="button"
                  aria-label={`Delete ${asset.fileName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(asset.id);
                  }}
                  className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto hover:bg-black/70"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox Overlay */}
      {expandedAsset && (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-8 animate-in fade-in duration-200"
          onClick={() => setExpandedAsset(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img
              src={mediaAssetUrl(expandedAsset.id, serverId)}
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
                aria-label="Overall indexing progress"
                className={cn('mt-2 h-1', INDEXING_PROGRESS_CLASS)}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {asset.processingStatus === 'failed' ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onProcess(asset.id)}
              >
                Retry
              </Button>
            ) : null}
            {asset.processingStatus === 'completed' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => onProcess(asset.id)}
              >
                Re-index
              </Button>
            ) : null}
            {!isActiveJob(asset) ? (
              <button
                type="button"
                aria-label={`Delete ${asset.fileName}`}
                onClick={() => onDelete(asset.id)}
                className="text-red-500 p-1.5 rounded cursor-pointer hover:text-red-600 transition-all"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
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
          className="truncate max-w-30 sm:max-w-50"
          title={asset.processingMessage || 'Processing...'}
        >
          {asset.processingMessage || 'Processing...'}
        </span>
        <span className="tabular-nums">{Math.round(asset.processingProgress ?? 0)}% overall</span>
      </span>
    );
  }
  if (status === 'pending' && asset.processingMessage) {
    return (
      <span className="flex items-center gap-1 rounded-sm bg-blue-50/50 px-1.5 py-0.5 text-[10px] text-blue-600">
        <Loader2 className="size-2.5 shrink-0 animate-spin" />
        <span className="max-w-30 truncate sm:max-w-50" title={asset.processingMessage}>
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
        <span className="truncate max-w-30">{asset.processingError || 'Failed'}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
      <Clock className="size-2.5 shrink-0" />
      <span className="truncate max-w-30" title={asset.processingMessage || 'Pending...'}>
        {asset.processingMessage || 'Pending...'}
      </span>
    </span>
  );
}

function ActiveIndexingList({
  assets,
  onPause,
  onRemove,
}: {
  assets: MediaAsset[];
  onPause: (asset: MediaAsset) => void;
  onRemove: (asset: MediaAsset) => void;
}) {
  return (
    <section
      aria-live="polite"
      aria-label="Active media indexing jobs"
      className="space-y-3 rounded-xl border border-emerald-500 bg-emerald-50/20 p-3 dark:border-emerald-700/60 dark:bg-emerald-950/20"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-foreground">
            Indexing {assets.length} {assets.length === 1 ? 'file' : 'files'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {assets.map((asset) => {
          const progress = Math.max(1, Math.min(100, asset.processingProgress ?? 1));
          return (
            <div
              key={asset.id}
              className="space-y-2 rounded-lg border border-transparent bg-background/40 p-2.5 relative group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pr-6">
                  <p className="truncate text-[11px] font-medium text-foreground">
                    {asset.fileName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                    Overall {Math.round(progress)}%
                  </span>
                  {asset.type !== 'image' ? (
                    <button
                      type="button"
                      title={asset.processingPaused ? 'Resume Indexing' : 'Pause Indexing'}
                      aria-label={
                        asset.processingPaused
                          ? `Resume ${asset.fileName}`
                          : `Pause ${asset.fileName}`
                      }
                      onClick={() => onPause(asset)}
                      className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {asset.processingPaused ? (
                        <Play className="size-3" />
                      ) : (
                        <Pause className="size-3" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title="Remove file"
                    aria-label={`Remove ${asset.fileName}`}
                    onClick={() => onRemove(asset)}
                    className="p-1 -mr-1 rounded-full text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
              <ActiveIndexingDescription asset={asset} />
              {asset.activeVideoKnowledgeJobId ? (
                <p
                  className="truncate text-[9px] text-muted-foreground"
                  title={asset.activeVideoKnowledgeJobId}
                >
                  Knowledge job {asset.activeVideoKnowledgeJobId.slice(0, 8)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActiveIndexingDescription({ asset }: { asset: MediaAsset }) {
  const step = primaryRunningMediaStep(asset.processingSteps);
  const progress = mediaStepProgress(step);
  const stepDescription = describeActiveMediaStep(step);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <ElapsedTime startTime={asset.createdAt} />
        <p className="truncate text-[10px] text-muted-foreground animate-pulse">
          {asset.processingPaused
            ? 'Paused — resume when you are ready.'
            : asset.processingMessage || 'Preparing media indexing...'}
        </p>
      </div>
      {!asset.processingPaused && stepDescription ? (
        <div className="space-y-1" aria-live="polite">
          <div className="flex min-w-0 items-center gap-1.5 text-[9px] text-muted-foreground/80">
            <span className="truncate">{stepDescription}</span>
          </div>
          {progress === null ? (
            <div
              className="h-1 overflow-hidden rounded-full bg-muted"
              aria-label="Active operation in progress"
            >
              <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-500/70" />
            </div>
          ) : (
            <Progress
              value={progress}
              aria-label={`${stepDescription} progress`}
              className={cn('h-1 bg-muted', INDEXING_PROGRESS_CLASS)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ElapsedTime({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startTime).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <span className="font-mono tabular-nums text-[10px] text-muted-foreground/60">
      {mins}:{secs.toString().padStart(2, '0')}
    </span>
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
