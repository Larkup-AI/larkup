'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type CrawlerResponse = {
  state: { running: boolean; mode?: 'native' | 'firecrawl'; lastError?: string };
  starting?: boolean;
};

type Status = 'starting' | 'ready' | 'unavailable';

const STATUS_POLL_MS = 2_000;

/** Compact readiness indicator for the crawler embedded in the Larkup API. */
export function WebCrawlerStatus() {
  const [status, setStatus] = useState<Status>('starting');
  const [statusDetail, setStatusDetail] = useState('');
  const requestInFlight = useRef(false);
  const mounted = useRef(false);

  function applyStatus(body: CrawlerResponse) {
    if (!mounted.current) return;
    if (body.state.running) {
      setStatus('ready');
      setStatusDetail('');
      return;
    }
    if (body.starting) {
      setStatus('starting');
      setStatusDetail('');
      return;
    }
    setStatus('unavailable');
    setStatusDetail(body.state.lastError || '');
  }

  async function requestStatus(start: boolean) {
    const res = await fetch(
      '/api/firecrawl/local',
      start
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start' }),
          }
        : { cache: 'no-store' },
    );
    const body = (await res.json()) as CrawlerResponse;
    if (!res.ok) throw new Error('Crawler status failed');
    return body;
  }

  async function updateStatus(forceStart = false) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      if (forceStart) {
        if (mounted.current) setStatus('starting');
        applyStatus(await requestStatus(true));
        return;
      }

      applyStatus(await requestStatus(false));
    } catch {
      if (mounted.current) {
        setStatus('unavailable');
        setStatusDetail(
          'The crawler status could not be reached. Larkup will retry automatically.',
        );
      }
    } finally {
      requestInFlight.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    void updateStatus(true);
    const interval = window.setInterval(() => void updateStatus(), STATUS_POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, []);

  const label =
    status === 'ready'
      ? 'Website crawler is ready'
      : status === 'starting'
        ? 'Preparing website crawler…'
        : statusDetail ||
          'Website crawler is temporarily unavailable. Larkup will retry automatically.';

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Website crawler status"
              data-status={status}
              className="relative flex size-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void updateStatus(true)}
            >
              <span
                className={cn(
                  'relative block size-2 rounded-full',
                  status === 'ready'
                    ? 'bg-emerald-500'
                    : status === 'starting'
                      ? 'bg-blue-500'
                      : 'bg-red-500',
                )}
              >
                {status === 'starting' && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/80" />
                )}
              </span>
            </button>
          }
        />
        <TooltipContent className="max-w-60 text-xs">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
