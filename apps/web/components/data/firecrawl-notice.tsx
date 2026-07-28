'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Loader2, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/error-formatter';
import { Button } from '@/components/ui/button';

interface LocalState {
  running: boolean;
  endpoint: string;
  port: number;
  hasKey: boolean;
  startedAt?: string;
  lastError?: string;
}
interface DockerState {
  docker: boolean;
  compose: boolean;
  message: string;
}
interface LocalResponse {
  state: LocalState;
  docker: DockerState;
  runtimeEnv?: 'web' | 'desktop' | 'docker';
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function FirecrawlNotice({
  cloudConfigured = false,
  onChange,
  onErrorChange,
}: {
  cloudConfigured?: boolean;
  onChange?: () => void;
  onErrorChange?: (hasError: boolean) => void;
}) {
  const router = useRouter();
  const { data, mutate, isLoading } = useSWR<LocalResponse>('/api/firecrawl/local', fetcher, {
    refreshInterval: (d) => (d?.state.running || d?.state.startedAt ? 8000 : 0),
  });
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);

  const state = data?.state;
  const docker = data?.docker;
  const runtimeEnv = data?.runtimeEnv ?? 'web';
  const running = state?.running ?? false;
  const dockerReady = docker?.compose ?? false;
  const hasError = !cloudConfigured && (!running || !!state?.lastError);

  useEffect(() => {
    if (!isLoading) {
      onErrorChange?.(hasError);
    }
  }, [hasError, isLoading, onErrorChange]);

  async function control(action: 'start' | 'stop') {
    setBusy(action);
    if (action === 'start') {
      toast.info(
        runtimeEnv === 'docker' ? 'Connecting to crawler service…' : 'Launching web crawler…',
        {
          description:
            runtimeEnv === 'docker'
              ? 'Checking if the crawler service is available on the network.'
              : 'Starting Larkup’s built-in crawler. ',
        },
      );
    }
    try {
      const res = await fetch('/api/firecrawl/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as { state?: LocalState; error?: string };
      if (!res.ok) throw new Error(json.error || 'Request failed');

      if (action === 'start') {
        if (json.state?.running) {
          toast.success('Web crawler is running', {
            description: 'Web scraping is now active.',
          });
        } else if (runtimeEnv === 'docker') {
          toast.error('Crawler service is not part of this container', {
            description:
              'Start Larkup with the optional crawler profile in docker-compose, or add a Firecrawl API key in Settings.',
          });
        } else {
          toast.success('Web crawler is ready', {
            description: 'You can now scrape websites without Docker.',
          });
        }
      } else {
        toast.success('Web crawler stopped');
      }
      await mutate();
      onChange?.();
    } catch (err) {
      toast.error('Could not connect to the web crawler', {
        description: formatErrorMessage(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {running ? (
        <Button
          variant="outline"
          className="h-10 gap-1.5 rounded-md bg-red-500 hover:bg-red-600 text-white hover:text-white hover:border-red-200 text-sm px-4 shadow-none"
          onClick={() => control('stop')}
          disabled={busy !== null}
        >
          {busy === 'stop' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Square className="size-3" />
          )}
          Stop Crawler
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            control('start');
          }}
          disabled={busy !== null || isLoading}
          className="h-10 gap-1.5 rounded-md text-sm px-4 shadow-none bg-orange-500 text-white hover:bg-orange-600 hover:text-white"
        >
          {busy === 'start' ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : (
            <img src="/icons/firecrawl2.png" alt="" className="size-3 object-contain" />
          )}
          {runtimeEnv === 'docker'
            ? dockerReady
              ? 'Connect Crawler'
              : 'Crawler Setup'
            : 'Launch Crawler'}
        </Button>
      )}
    </div>
  );
}
