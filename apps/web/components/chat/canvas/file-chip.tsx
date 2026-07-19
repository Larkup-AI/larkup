'use client';

import { FileText, FileSpreadsheet, Presentation, File as FileIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDocEditor } from './doc-editor-provider';

/* ------------------------------------------------------------------ */
/* File type icon/color mapping                                        */
/* ------------------------------------------------------------------ */

const FILE_TYPE_CONFIG: Record<
  string,
  { icon: typeof FileText; color: string; bg: string; label: string }
> = {
  pdf: {
    icon: FileText,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-900/20',
    label: 'PDF',
  },
  docx: {
    icon: FileText,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    label: 'DOCX',
  },
  pptx: {
    icon: Presentation,
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    label: 'PPTX',
  },
  txt: {
    icon: FileIcon,
    color: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-50 dark:bg-gray-900/20',
    label: 'TXT',
  },
  xlsx: {
    icon: FileSpreadsheet,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-900/20',
    label: 'XLSX',
  },
};

function getFileConfig(fileName: string) {
  const ext = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase();
  return FILE_TYPE_CONFIG[ext] ?? FILE_TYPE_CONFIG['txt'];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* FileChip — minimal inline file preview in chat messages             */
/* ------------------------------------------------------------------ */

interface FileChipProps {
  fileName: string;
  fileSize?: number;
  fileType?: string;
  /** If provided, clicking opens/focuses this file in the canvas */
  sessionId?: string;
  /** Compact mode for inline display */
  compact?: boolean;
  className?: string;
}

export function FileChip({
  fileName,
  fileSize,
  fileType,
  sessionId,
  compact = false,
  className,
}: FileChipProps) {
  const config = getFileConfig(fileName);
  const Icon = config.icon;

  // Try to use doc editor context (may not exist in all contexts)
  let toggleCanvas: (() => void) | undefined;
  try {
    const editor = useDocEditor();
    toggleCanvas = editor.toggleCanvas;
  } catch {
    // Not inside DocEditorProvider — that's fine
  }

  const handleClick = () => {
    if (sessionId && toggleCanvas) {
      toggleCanvas();
    }
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 text-xs transition',
          'hover:bg-secondary cursor-pointer',
          className,
        )}
      >
        <Icon className={cn('size-3 shrink-0', config.color)} />
        <span className="truncate max-w-[120px] text-foreground">{fileName}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border/60 px-3.5 py-2.5 transition',
        'hover:bg-secondary/50 cursor-pointer group',
        'w-full max-w-[280px]',
        className,
      )}
    >
      <div
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', config.bg)}
      >
        <Icon className={cn('size-4', config.color)} />
      </div>
      <div className="flex flex-col items-start min-w-0">
        <span className="truncate w-full text-[13px] font-medium text-foreground text-left">
          {fileName}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'rounded px-1 py-0.5 text-[9px] font-semibold uppercase',
              config.bg,
              config.color,
            )}
          >
            {config.label}
          </span>
          {fileSize && <span>{formatFileSize(fileSize)}</span>}
        </span>
      </div>
    </button>
  );
}
