"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "@/lib/error-formatter";
import {
  Image,
  Video,
  AudioLines,
  Loader2,
  X,
  Upload,
  FileUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

const MEDIA_TYPES = {
  image: {
    label: "Images",
    icon: Image,
    accept: "image/*",
    description: "Upload images (PNG, JPG, WebP, GIF, SVG)",
  },
  video: {
    label: "Videos",
    icon: Video,
    accept: "video/*",
    description: "Upload video files (MP4, WebM, MOV)",
  },
  audio: {
    label: "Audio",
    icon: AudioLines,
    accept: "audio/*",
    description: "Upload audio files (MP3, WAV, OGG, M4A)",
  },
} as const;

type MediaType = keyof typeof MEDIA_TYPES;

interface StagedMedia {
  id: string;
  file: File;
  type: MediaType;
  preview?: string;
}

export function MediaPanel({ onAdded }: { onAdded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [activeType, setActiveType] = useState<MediaType | "all">("all");

  function getMediaType(file: File): MediaType | null {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return null;
  }

  function handleFiles(files: FileList | File[]) {
    const newFiles: StagedMedia[] = [];
    for (const file of Array.from(files)) {
      const type = getMediaType(file);
      if (!type) {
        toast.error(`Unsupported file type: ${file.name}`);
        continue;
      }
      const id = Math.random().toString(36).slice(2);
      let preview: string | undefined;
      if (type === "image") {
        preview = URL.createObjectURL(file);
      }
      newFiles.push({ id, file, type, preview });
    }
    if (newFiles.length === 0) return;
    setStaged((prev) => [...prev, ...newFiles]);
  }

  function removeFile(id: string) {
    setStaged((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  }

  function clearAll() {
    staged.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setStaged([]);
  }

  async function uploadAll() {
    if (staged.length === 0) return;
    setUploading(true);
    setProgress({ current: 0, total: staged.length });

    let success = 0;
    for (let i = 0; i < staged.length; i++) {
      const item = staged[i];
      setProgress({ current: i + 1, total: staged.length });
      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("mediaType", item.type);

        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: item.file.name,
            content: `[${item.type}] ${item.file.name} (${formatSize(item.file.size)})`,
            source: "upload",
            metadata: {
              mediaType: item.type,
              fileName: item.file.name,
              fileSize: item.file.size,
              mimeType: item.file.type,
            },
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
        success++;
      } catch (err) {
        toast.error(`Failed to upload ${item.file.name}: ${formatErrorMessage(err)}`);
      }
    }

    if (success > 0) {
      toast.success(`${success} file${success !== 1 ? "s" : ""} uploaded`);
      onAdded();
    }
    clearAll();
    setUploading(false);
    setProgress(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  const filteredStaged =
    activeType === "all"
      ? staged
      : staged.filter((f) => f.type === activeType);

  const acceptAll = "image/*,video/*,audio/*";

  return (
    <div className="space-y-4">
      {/* Media type filter pills */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveType("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
            activeType === "all"
              ? "bg-primary/10 border-primary/20 text-primary"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          All
        </button>
        {(Object.entries(MEDIA_TYPES) as [MediaType, (typeof MEDIA_TYPES)[MediaType]][]).map(
          ([key, meta]) => {
            const Icon = meta.icon;
            const count = staged.filter((f) => f.type === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveType(key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border transition-colors flex items-center gap-1.5",
                  activeType === key
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="size-3" />
                {meta.label}
                {count > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          },
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 cursor-pointer transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/30",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Upload className="size-5 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Drop media files here or click to browse
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Supports images, videos, and audio files
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAll}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Staged files */}
      {filteredStaged.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {staged.length} file{staged.length !== 1 ? "s" : ""} ready
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {filteredStaged.map((item) => {
              const meta = MEDIA_TYPES[item.type];
              const Icon = meta.icon;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 group"
                >
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt={item.file.name}
                      className="size-10 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <div className="flex size-10 items-center justify-center rounded-md bg-muted shrink-0">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {item.file.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatSize(item.file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(item.id)}
                    className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:text-foreground transition-all"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Upload progress */}
          {progress && (
            <div className="space-y-1.5">
              <Progress
                value={(progress.current / progress.total) * 100}
                className="h-1.5"
              />
              <p className="text-xs text-muted-foreground text-center tabular-nums">
                Uploading {progress.current} of {progress.total}
              </p>
            </div>
          )}

          {/* Upload button */}
          <Button
            onClick={uploadAll}
            disabled={uploading || staged.length === 0}
            className="w-full"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileUp className="size-4" />
            )}
            Upload {staged.length} file{staged.length !== 1 ? "s" : ""}
          </Button>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
