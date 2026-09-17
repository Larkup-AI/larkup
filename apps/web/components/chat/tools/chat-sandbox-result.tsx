'use client';

import { useMemo } from 'react';
import { ChevronDown, Play, Clock, Image as ImageIcon, Table2 } from 'lucide-react';
import { ChatDataTable, type DataTableConfig } from '@/components/chat/tools/chat-data-table';
import { Card, CardContent } from '@/components/ui/card';

interface SandboxArtifact {
  name: string;
  mimeType: string;
  data: string; // base64
}

export interface SandboxResultConfig {
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts: SandboxArtifact[];
  executionTimeMs: number;
}

function tryParseStdoutAsTable(stdout: string): DataTableConfig | null {
  return null;
}

export function ChatSandboxResult({ config }: { config: SandboxResultConfig }) {
  const { stdout, stderr, exitCode, artifacts, executionTimeMs } = config;

  const images = useMemo(
    () => artifacts.filter((a) => a.mimeType.startsWith('image/')),
    [artifacts],
  );

  // Try to parse stdout as structured table data
  const stdoutTable = useMemo(() => tryParseStdoutAsTable(stdout), [stdout]);

  const isSuccess = exitCode === 0;
  const isRuntimeUnavailable =
    /docker\.sock|docker (?:isn't|is not) running|code execution is unavailable|needs python 3/i.test(
      stderr,
    );

  return (
    <Card className="overflow-hidden  animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* A successful result speaks for itself; retain a clear header only for failures. */}
      {!isSuccess && (
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              <Play className="size-3" />
            </div>
            <span className="text-xs font-medium text-foreground">Analysis failed</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
            <Clock className="size-3" />
            {executionTimeMs < 1000
              ? `${executionTimeMs}ms`
              : `${(executionTimeMs / 1000).toFixed(1)}s`}
          </span>
        </div>
      )}

      {/* Generated images (matplotlib charts, etc.) */}
      {images.length > 0 && (
        <div className="space-y-3 p-4">
          {images.map((img, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-border/40">
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={img.name}
                className="w-full"
              />
              <div className="flex items-center gap-2 border-t border-border/40 px-3 py-1.5">
                <ImageIcon className="size-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{img.name}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Structured stdout (rendered as table) */}
      {stdoutTable && (
        <CardContent className="p-3 pt-3">
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <Table2 className="size-3" />
            <span className="font-medium">Analysis Results</span>
          </div>
          <ChatDataTable config={stdoutTable} />
        </CardContent>
      )}

      {/* Plain stdout (only if not parsed as table) */}
      {stdout && !stdoutTable && (
        <div className="border-b border-border/40 px-4 py-3">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground [&::-webkit-scrollbar]:hidden">
            {stdout}
          </pre>
        </div>
      )}

      {/* Error display */}
      {!isSuccess && (
        <div className="border-t border-border/40 bg-red-50/50 p-4 dark:bg-red-900/10">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-red-800 dark:text-red-400">
              {isRuntimeUnavailable ? 'Analysis is unavailable' : 'Analysis encountered an issue'}
            </span>
            <span className="text-xs text-red-600/80 dark:text-red-400/80">
              {isRuntimeUnavailable
                ? 'This workspace does not have a code-analysis runtime configured.'
                : 'This calculation could not be completed.'}
            </span>
            {stderr && !isRuntimeUnavailable && (
              <details className="mt-2 group">
                <summary className="cursor-pointer text-xs font-medium text-red-600/70 hover:text-red-600 dark:text-red-400/70 dark:hover:text-red-400 transition-colors list-none flex items-center gap-1">
                  <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                  Technical Details
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-red-100/50 p-3 text-[11px] leading-relaxed text-red-900/70 dark:bg-red-900/20 dark:text-red-200/70 [&::-webkit-scrollbar]:hidden">
                  {stderr}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
