'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCacheBytes } from '@/lib/cache-size';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface CacheResponse {
  cache: {
    available: boolean;
    exists: boolean;
    sizeBytes: number;
    answerFeedback?: {
      likedEntries: number;
      dislikedEntries: number;
      sizeBytes: number;
    };
  };
  clearedBytes?: number;
  error?: string;
}

async function fetchCache(url: string): Promise<CacheResponse> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = (await response.json()) as CacheResponse;
  if (!response.ok) throw new Error(payload.error || 'Could not inspect the Larkup cache.');
  return payload;
}

export function CacheManagementCard() {
  const { data, error, isLoading, isValidating, mutate } = useSWR('/api/system/cache', fetchCache, {
    revalidateOnMount: true,
    revalidateOnFocus: true,
    dedupingInterval: 0,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const cache = data?.cache;

  async function clearCache() {
    setClearing(true);
    try {
      const response = await fetch('/api/system/cache', { method: 'DELETE' });
      const payload = (await response.json()) as CacheResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not clear the Larkup cache.');
      await mutate(payload, { revalidate: false });
      setConfirmOpen(false);
      toast.success(`Cleared ${formatCacheBytes(payload.clearedBytes || 0)} of Larkup cache.`);
    } catch (clearError) {
      toast.error(
        clearError instanceof Error ? clearError.message : 'Could not clear the Larkup cache.',
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Larkup cache</CardTitle>
              <CardDescription className="mt-1 text-xs">
                Temporary files that help Larkup run smoothly. You can clear them anytime to free up
                space.
              </CardDescription>
            </div>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <HardDrive className="size-4" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Detected cache size</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {isLoading ? '—' : formatCacheBytes(cache?.sizeBytes || 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error
                  ? 'Cache size could not be read.'
                  : cache?.available === false
                    ? 'No Larkup cache is present on this installation.'
                    : cache?.exists
                      ? 'Safe to clear. Larkup recreates temporary data only when needed.'
                      : 'No temporary cache data is currently stored.'}
              </p>
              {!error && cache?.answerFeedback ? (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="answer-cache-counts">
                  Across all projects: {cache.answerFeedback.likedEntries} liked answer
                  {cache.answerFeedback.likedEntries === 1 ? '' : 's'} and{' '}
                  {cache.answerFeedback.dislikedEntries} disliked answer
                  {cache.answerFeedback.dislikedEntries === 1 ? '' : 's'} tracked.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-label="Refresh Larkup cache size"
                disabled={isLoading || isValidating}
                onClick={() => void mutate()}
              >
                <RefreshCw className={`size-3.5 ${isValidating ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!cache?.exists || clearing}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="size-3.5" />
                Clear cache
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 className="size-5" />
            </AlertDialogMedia>
            <AlertDialogTitle>Clear the Larkup cache?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {formatCacheBytes(cache?.sizeBytes || 0)} of temporary build,
              package, image-analysis, video-query, and answer-feedback data. It will not remove
              projects, indexed sources, settings, API keys, user corrections, chat history, or
              installed tools.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={clearing}
              onClick={() => void clearCache()}
            >
              {clearing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Clear cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
