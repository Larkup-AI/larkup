'use client';

import { useCallback, useState } from 'react';
import { Check, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DataExportArtifact } from '@/lib/chat/data-export';

function base64Bytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function ChatFileExport({ artifact }: { artifact: DataExportArtifact }) {
  const [downloaded, setDownloaded] = useState(false);
  const download = useCallback(() => {
    const blob = new Blob([base64Bytes(artifact.fileBase64)], { type: artifact.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setDownloaded(true);
  }, [artifact]);
  const Icon = artifact.format === 'xlsx' || artifact.format === 'csv' ? FileSpreadsheet : FileText;

  return (
    <div className="my-3 flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{artifact.fileName}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {artifact.rowCount.toLocaleString()} {artifact.rowCount === 1 ? 'row' : 'rows'} ·{' '}
          {artifact.format.toUpperCase()}
        </div>
      </div>
      <Button size="sm" onClick={download} className="h-8 shrink-0 gap-1.5 px-3 text-xs">
        {downloaded ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
        {downloaded ? 'Downloaded' : 'Download'}
      </Button>
    </div>
  );
}
